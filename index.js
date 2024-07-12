const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

app.get("/", (req, res) => {
    res.sendFile(__dirname + "/index.html");
});

const players = {
    primary: 'X',
    secondary: 'O'
}

const nextPlayer = {
    [players.primary]: players.secondary,
    [players.secondary]: players.primary
};

let rooms = [];

function addToRoom(room, user) {
    rooms.forEach((availableRoom) => {
        if (availableRoom.name === room) {
            availableRoom.users.push(user);

            // if this is the first user to join the room, set the primary user
            if (availableRoom.users.length === 1) {
                availableRoom.primaryUser = user;
            }
        }



    });
}

function removeFromRoom(room, user) {
    rooms.forEach((availableRoom) => {
        if (availableRoom.name === room) {
            availableRoom.users = availableRoom.users.filter(
                (availableUser) => availableUser !== user
            );

            // if primary user is deleted, set the new primary user
            if (availableRoom.primaryUser === user) {
                availableRoom.primaryUser = availableRoom.users[0];
            }
        }
    });
}

function restartGameInRoom(room) {
    const roomToRestart = rooms.find((availableRoom) => availableRoom.name === room);
    roomToRestart.state = {
        currentPlayer: players.primary,
        cells: Array.from(Array(9).keys()).map(() => ''),
        winner: null
    };
    return roomToRestart.state;
}

function addRoom(room) {
    const roomToAdd = {
        name: room,
        users: [],
        primaryUser: '',
        state: {
            currentPlayer: 'X',
            cells: Array.from(Array(9).keys()).map(() => ''),
            winner: null
        }
    };
    rooms.push(roomToAdd);
}

function deleteRoom(room) {
    rooms = rooms.filter((availableRoom) => availableRoom.name !== room);
}

function calculateWinner(cells) {
    console.log(cells);

    const positions = cells.reduce((acc, current, index) => {
        console.log({ acc, current, index });
        if (current === '') {
            return acc;
        }
        acc[current].push(index);
        return acc;
    }, {
        [players.primary]: [],
        [players.secondary]: []
    });

    // Check if atleast one of the players has 3 in a row
    const primaryCouldWin = positions[players.primary].length >= 3;
    const secondaryCouldWin = positions[players.secondary].length >= 3;

    if (!primaryCouldWin && !secondaryCouldWin) {
        return null;
    }
    let winner = null;
    const winningPositions = [
        [0, 1, 2],
        [3, 4, 5],
        [6, 7, 8],
        [0, 3, 6],
        [1, 4, 7],
        [2, 5, 8],
        [0, 4, 8],
        [2, 4, 6]
    ];

    // Check winner
    winningPositions.forEach((winningPosition) => {
        const [a, b, c] = winningPosition;
        if (positions[players.primary].includes(a) && positions[players.primary].includes(b) && positions[players.primary].includes(c)) {
            winner = players.primary;
        }
        if (positions[players.secondary].includes(a) && positions[players.secondary].includes(b) && positions[players.secondary].includes(c)) {
            winner = players.secondary;
        }
    });

    return winner;
}

function calculateState(state) {
    if (!state) {
        return {};
    }

    if (state.winner) {
        return state;
    }

    const nextTurn = nextPlayer[state.player];
    const newCells = state.cells;
    const winner = calculateWinner(newCells);

    const newState = {
        currentPlayer: nextTurn,
        cells: newCells,
        winner
    };

    return newState;


};

function isPrimary(room, user) {
    return rooms.find((availableRoom) => availableRoom.name === room).primaryUser === user;
}

function generateUserSig(room, user) {
    return isPrimary(room, user) ? players.primary : players.secondary;
}

function shouldStartGame(room) {
    // Return true if there are two users in the room
    return rooms.find((availableRoom) => availableRoom.name === room).users.length === 2;
}

io.of("/").adapter.on("create-room", (room) => {
    console.log("room created", room);
    addRoom(room);
});

io.of("/").adapter.on("leave-room", (room, id) => {
    console.log("room left", room, id);
    removeFromRoom(room, id);
});

io.of("/").adapter.on("delete-room", (room) => {
    console.log("room deleted", room);
    deleteRoom(room);
});

io.of("/").adapter.on("join-room", (room, id) => {
    console.log(`socket ${id} has joined room ${room}`);
    addToRoom(room, id);
    io.to(id).emit("joined-room", {
        room,
        player: generateUserSig(room, id)
    });

    if (shouldStartGame(room)) {
        io.to(room).emit('start-game', {
            room,
        });

    }
});

io.on("connection", (socket) => {
    console.log("a user connected: ", socket.id);

    socket.on("create", (payload) => {
        socket.join(payload.room);
    });

    socket.on("join", (payload) => {
        if (!rooms.find((room) => room.name === payload.room)) {
            socket.emit('error', 'Room does not exist');
            return;
        }

        socket.join(payload.room);
    });

    socket.on("leave", (payload) => {
        socket.leave(payload.room);
    });

    socket.on("restart-game", (payload) => {
        const room = payload.room;
        const state = restartGameInRoom(room);
        io.to(room).emit('game-move', state);
    });
    socket.on('game-move', (payload) => {
        console.log("game-move", payload);
        // do some changes with state
        const { player, room: roomName, cells } = payload;
        const currentRoom = rooms.find((room) => room.name === roomName);
        if (!currentRoom || !currentRoom.users.includes(socket.id)) {
            socket.emit('error', 'Room does not exist');
            return;
        }
        currentRoom.state = calculateState(payload);
        console.log('=======Calculated state', currentRoom.state);
        io.to(roomName).emit('game-move', currentRoom.state);
    });
});

const port = process.env.PORT || 8080;

server.listen(port, () => {
    console.log("listening on *:" + port);
});
