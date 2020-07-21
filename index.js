const express = require('express');
const fetch = require('node-fetch');
const redis = require("async-redis");
const bodyParser = require('body-parser');
const { json } = require('body-parser');

const PORT = process.env.PORT || 5000;
const REDIS_PORT = process.env.PORT || 6379;

const client = redis.createClient(REDIS_PORT);

const app = express();
app.use(bodyParser.json())
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const SOCKET_PORT = 3000

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

const sendRequest = async (data) => {
    let agents = await redisGetData('agent') || []
    agents.map((agent) => {
        let { socketId } = agent
        if (io.sockets.sockets[socketId] != undefined) {
            setTimeout(() => {
                // sending to individual socketid (private message)
                io.to(socketId).emit('notification', data);
            }, 5000);
        }
    })
}

async function joinChat(req, res, next) {
    let data = req.body
    let { type } = data
    if (type == "customer") {
        sendRequest(data)
    }
    addUser(data)
    res.send("Done")
}

async function getAgents(req, res, next) {
    let data = await redisGetData('agent')
    res.send(data)
}

async function getCustomers(req, res, next) {
    let data = await redisGetData('customer')
    res.send(data)
}

/**Routes */
app.get('/repos/:username', cache, getRepos);

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
        console.log("Filter", filteredAgent)
        redisSetData('agent', filteredAgent)

        let customers = await redisGetData('customer') || []
        let filteredCustomer = customers.filter(customer => customer.socketId != socket.id)
        console.log("Filter", filteredCustomer)
        redisSetData('customer', filteredCustomer)

        console.log(data);
    });
});


/**Start Server */
app.listen(5000, () => {
    console.log(`App listening on port ${PORT}`);
});


http.listen(SOCKET_PORT, () => {
    console.log(`Socket listening on: `, SOCKET_PORT);
});
