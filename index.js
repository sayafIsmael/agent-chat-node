const express = require('express');
const fetch = require('node-fetch');
const redis = require("async-redis");
const bodyParser = require('body-parser');
const cors = require('cors')

const PORT = process.env.PORT || 5000;
const REDIS_PORT = process.env.PORT || 6379;

const client = redis.createClient(REDIS_PORT);

const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const SOCKET_PORT = 4000

app.use(bodyParser.json())
app.use(cors())


// Set response
function setResponse(username, repos) {
    return `<h2>${username} has ${repos} Github repos</h2>`;
}

// Make request to Github for data
async function getRepos(req, res, next) {
    try {
        console.log('Fetching Data...');

        const { username } = req.params;

        const response = await fetch(`https://api.github.com/users/${username}`);

        const data = await response.json();

        const repos = data.public_repos;

        // Set data to Redis
        client.setex(username, 1000, repos);

        res.send(setResponse(username, repos));
    } catch (err) {
        console.error(err);
        res.status(500);
    }
}

// Cache middleware
function cache(req, res, next) {
    const { username } = req.params;

    client.get(username, (err, data) => {
        if (err) throw err;

        if (data !== null) {
            res.send(setResponse(username, data));
        } else {
            next();
        }
    });
}


const redisSetData = async (key, value) => {
    return await client.set(key, JSON.stringify(value));
};

const redisGetData = async (key) => {
    let val = await client.get(key);
    return JSON.parse(val);
};


const addUser = async (data) => {
    let { type, socketId } = data
    let users = await redisGetData(type) || []

    if (users.some(user => user.socketId === socketId)) {
        return false
    }
    users.push(data)
    redisSetData(type, users)
    return true
}

async function clearOffline() {
    let agents = await redisGetData('agent') || []
    let filteredAgent = []
    agents.map(({ socketId }, i) => {
        console.log("remove agent: ", i)
        if (io.sockets.sockets[socketId] != undefined) {
            filteredAgent.push(agents[i]);
        }
    })
    redisSetData('agent', filteredAgent)

    let customers = await redisGetData('customer') || []
    let filteredCustomer = []
    customers.map(({ socketId }, i) => {
        console.log("remove customer: ", i)
        if (io.sockets.sockets[socketId] != undefined) {
            filteredCustomer.push(customers[i]);
        }
    })
    redisSetData('customer', filteredCustomer)

}

const notify = (socketId, data) => {
    if (io.sockets.sockets[socketId] != undefined) {
        io.to(socketId).emit('notification', data);
    }
}

async function joinChat(req, res, next) {
    let data = req.body
    let add = addUser(data)
    if (add) {
        res.send({ success: true })
        return
    }
    res.send({ error: "Something wrong! User might exist." })

}

async function getAgents(req, res, next) {
    let data = await redisGetData('agent')
    console.log("get agent data: ", data)
    res.send(data)
}

async function getCustomers(req, res, next) {
    let data = await redisGetData('customer')
    res.send(data)
}

function acceptRequest(req, res, next) {
    let data = req.body
    let { customerId, agent } = data
    io.to(customerId).emit('greetings', agent);
    res.send(`accepted ${customerId}`)
}

async function extractSockets(arr = []) {
    let data = []
    arr.map((user) => {
        data.push(user.socketId)
    })
    return data
}



async function sendRequest(req, res, next) {
    try {
        let { socketId, name } = req.body
        let allAgents = await redisGetData('agent') || []
        let agentIds = await extractSockets(allAgents)
        console.log("avilable agents", agentIds)
        let sentRequests = await client.lrange(socketId + 'reqs', 0, -1) || []
        console.log("Sent req cache: ", agentIds)
        if (!agentIds.length) {
            io.to(socketId).emit('chatRequestError', 'No agent is avilable to chat right now.');
            res.send('No agent is avilable to chat right now.')
            return
        }
        for (i = 0; i < agentIds.length; i++) {
            if (!(sentRequests.includes(agentIds[i]))) {
                console.log(`${name} wants to chat with you`)
                notify(agentIds[i], `${name} wants to chat with you`)
                await client.lpush(socketId + 'reqs', agentIds[i])
                // res.send(`Sent request to ${agentIds[i]}`)
                break
            } else {
                io.to(socketId).emit('chatRequestError', 'No agent is avilable to chat right now.');
                res.send('No agent is avilable to chat right now.')
            }
        }
        res.send('Sending request to chat..')
    } catch (error) {
        console.log(error)
    }
}

/**Routes */
app.get('/repos/:username', cache, getRepos);
app.post('/accept-request', acceptRequest);
app.post('/send-request-next', sendRequest);

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.get('/available/agent', getAgents);
app.get('/available/customer', getCustomers);

// POST method route
app.post('/join', joinChat)



/**Socket routes */
io.on('connection', (socket) => {
    console.log('User connected. Id = ', socket.id);
    // sending to the client
    socket.emit('hello', 'Welcome to socket');

    socket.on('disconnect', async (data) => {
        let agents = await redisGetData('agent') || []
        let filteredAgent = agents.filter(agent => agent.socketId != socket.id)
        // console.log("Filter", filteredAgent)
        redisSetData('agent', filteredAgent)

        let customers = await redisGetData('customer') || []
        let filteredCustomer = customers.filter(customer => customer.socketId != socket.id)
        // console.log("Filter", filteredCustomer)
        redisSetData('customer', filteredCustomer)
        console.log(await client.lrange(socket.id + 'reqs', 0, -1))
        client.del(socket.id + 'reqs')

        console.log(data);
    });
});

clearOffline()

/**Start Server */
app.listen(5000, () => {
    console.log(`App listening on port ${PORT}`);
});


http.listen(SOCKET_PORT, () => {
    console.log(`Socket listening on: `, SOCKET_PORT);
});
