const express = require('express');
const fetch = require('node-fetch');
const redis = require('redis');
const bodyParser = require('body-parser');

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

function joinChat (req, res, next) {
    let { type } = req.body
    console.log("Req body: ", req.body)

    client.hmset(type, req.body, (err, reply) => {
        if(err) {
          console.error(err);
        } else {
          console.log(reply);
        }
    });
    res.send('POST request to the join')
}

function getAgents (req, res, next){
    client.hgetall('type agent', (err, data) => {
        if (err) throw err;

        if (data !== null) {
            console.log("Got clients: ", data)
            res.send(data);
        } else {
            next();
        }
    });
}

/**Routes */
app.get('/repos/:username', cache, getRepos);

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.get('/available/agent', getAgents);

// POST method route
app.post('/join', joinChat)



/**Socket routes */
io.on('connection', (socket) => {
    console.log('User connected. Id = ',socket.id);
    // sending to the client
    socket.emit('hello', 'Welcome to socket');

    socket.on('disconnect', (data) => {
        console.log(data);
    });
});


/**Start Server */
app.listen(5000, () => {
    console.log(`App listening on port ${PORT}`);
});


http.listen(SOCKET_PORT, () => {
    console.log(`listening on *: `,SOCKET_PORT);
});
