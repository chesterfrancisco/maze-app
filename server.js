import express from "express";
import http from "http";
import { WebSocket, WebSocketServer } from "ws";
import path from "path";
import { generateMaze } from "./public/js/maze.js"; // Use relative import

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const port = 3000;
const rooms = {}; // Store room data

app.use(express.static(path.join(process.cwd(), "public"))); // Adjust for ES Modules

app.get("/", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

// Handle WebSocket connections
wss.on("connection", (ws) => {
  ws.on("message", (message) => {
    const parsedMessage = JSON.parse(message);

    switch (parsedMessage.type) {
      case "coin-collected":
        handleCoinCollected(parsedMessage);
        break;

      case "create-room":
        handleCreateRoom(parsedMessage.roomId);
        break;

      case "join-room":
        handleJoinRoom(ws, parsedMessage);
        break;

      case "start-game":
        handleStartGame(parsedMessage.roomId);
        break;

      case "progress-update":
        handleProgressUpdate(parsedMessage);
        break;

      case "final-score":
        handleFinalScore(parsedMessage);
        break;

      case "player-finished":
        handlePlayerFinished(parsedMessage);
        break;

      // New case to check avatar availability
      case "check-avatar":
        handleCheckAvatar(parsedMessage, ws);
        break;

      case "avatar-selected":
        handleAvatarSelected(parsedMessage);
        break;

      case "player-move":
        broadcastToRoom(parsedMessage.roomId, {
          type: "player-move",
          playerId: parsedMessage.playerId,
          position: parsedMessage.position,
        });
        break;

      default:
        console.log("Unknown message type:", parsedMessage.type);
    }
  });

  // Handle WebSocket close event
  ws.on("close", () => {
    Object.keys(rooms).forEach((roomId) => {
      const room = rooms[roomId];
      if (!room) return;

      // Remove the player from the room
      const playerIndex = room.players.findIndex((p) => p.ws === ws);
      if (playerIndex !== -1) {
        const [disconnectedPlayer] = room.players.splice(playerIndex, 1);
        console.log(
          `Player ${disconnectedPlayer.playerId} disconnected from room ${roomId}.`
        );

        // Notify remaining players
        broadcastToRoom(roomId, {
          type: "player-disconnected",
          playerId: disconnectedPlayer.playerId,
        });

        // Delete room if no players remain
        if (room.players.length === 0) {
          delete rooms[roomId];
          console.log(`Room ${roomId} deleted because it is empty.`);
        }
      }
    });
  });
});

function handlePlayerFinished({ roomId, playerId }) {
  const room = rooms[roomId];
  if (!room) {
    console.error(`Room ${roomId} not found when handling player finish.`);
    return;
  }

  // Check if the finishedPlayers array exists
  if (!room.finishedPlayers) {
    room.finishedPlayers = [];
  }

  if (!room.finishedPlayers.includes(playerId)) {
    room.finishedPlayers.push(playerId);

    const finishOrder = room.finishedPlayers.length;
    const bonusPoints = 50 - (finishOrder - 1) * 10;
    room.scores[playerId] = (room.scores[playerId] || 0) + bonusPoints;

    console.log(
      `Player ${playerId} finished in room ${roomId} with bonus ${bonusPoints}.`
    );

    // Broadcast the updated leaderboard
    broadcastLeaderboard(roomId, false);
  }

  // Check if all players are done
  if (room.finishedPlayers.length === room.players.length) {
    broadcastLeaderboard(roomId, true);
  }
}

function broadcastLeaderboard(roomId, isFinal) {
  const room = rooms[roomId];
  if (!room) return;

  const leaderboard = room.finishedPlayers
    .map((playerId) => {
      const player = room.players.find((p) => p.playerId === playerId);
      return {
        playerId,
        name: player.name,
        score: room.scores[playerId] || 0, // Ensure scores include bonuses
        position: room.finishedPlayers.indexOf(playerId) + 1,
      };
    })
    .sort((a, b) => b.score - a.score); // Sort by score descending

  broadcastToRoom(roomId, {
    type: "leaderboard",
    leaderboard,
    isFinal,
  });

  console.log(`Leaderboard broadcasted for room ${roomId}:`, leaderboard);
}

function handleAvatarSelected(message) {
  const { roomId, playerId, avatar } = message;

  const room = rooms[roomId];
  if (!room) {
    console.error(`Room ${roomId} not found.`);
    return;
  }

  // Ensure selected avatars are tracked
  if (!room.selectedAvatars) {
    room.selectedAvatars = new Set();
  }

  // Check if the avatar is already selected
  if (room.selectedAvatars.has(avatar)) {
    const player = room.players.find((p) => p.playerId === playerId);
    if (player && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(
        JSON.stringify({
          type: "avatar-selection-error",
          message: "Avatar already selected. Choose another.",
        })
      );
    }
    return;
  }

  // Assign avatar to the player
  room.selectedAvatars.add(avatar);
  const player = room.players.find((p) => p.playerId === playerId);
  if (player) {
    player.avatar = avatar;
  }

  // Broadcast updated room state to all players
  broadcastToRoom(roomId, {
    type: "avatar-update",
    players: room.players.map((p) => ({
      playerId: p.playerId,
      name: p.name,
      avatar: p.avatar,
    })),
    selectedAvatars: Array.from(room.selectedAvatars),
  });

  console.log(`Player ${playerId} selected avatar ${avatar} in room ${roomId}`);
}

function handleCheckAvatar({ roomId, avatar, playerId }, ws) {
  const room = rooms[roomId];
  if (!room) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: `Room ${roomId} not found.`,
      })
    );
    console.error(`Room ${roomId} not found.`);
    return;
  }

  const isAvailable =
    !room.selectedAvatars || !room.selectedAvatars.has(avatar);

  ws.send(
    JSON.stringify({
      type: "avatar-status",
      avatarId: avatar,
      isAvailable,
    })
  );

  console.log(
    `Avatar check for "${avatar}" in room "${roomId}": ${
      isAvailable ? "Available" : "Already selected"
    }`
  );
}

// Create a new room
function handleCreateRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      players: [],
      maze: generateEmptyMaze(15, 15), // Initialize maze
      selectedAvatars: new Set(), // Track selected avatars
      coins: [], // Add an empty array for coins
      scores: {}, // Initialize scores object for the room
      finishedPlayers: [], // Initialize finishedPlayers
    };
    console.log(`Room created: ${roomId}`);
  } else {
    console.log(`Room already exists: ${roomId}`);
  }
}

// Handle coin collection
function handleCoinCollected({ roomId, playerId, coinPosition }) {
  const room = rooms[roomId];
  if (!room || !room.coins) {
    console.log(`Room or coins data missing for roomId: ${roomId}`);
    return;
  }

  // Find the coin
  const coinIndex = room.coins.findIndex(
    (coin) => coin.x === coinPosition.x && coin.y === coinPosition.y
  );

  if (coinIndex !== -1) {
    // Remove the coin from the server state
    room.coins.splice(coinIndex, 1);

    // Update the player's score
    room.scores[playerId] = (room.scores[playerId] || 0) + 10;

    // Broadcast the updated coin list and player score to all clients
    broadcastToRoom(roomId, {
      type: "update-coins",
      playerId,
      coinPosition,
      coins: room.coins, // Send the new list of coins
    });

    console.log(`Player ${playerId} collected a coin in Room ${roomId}.`);
  } else {
    console.log(`Coin at position ${JSON.stringify(coinPosition)} not found.`);
  }
}

// Generate an empty maze for initialization
function generateEmptyMaze(width, height) {
  return Array.from({ length: height }, () => Array(width).fill(0)); // All walkable cells
}

// Generate an empty maze with coins
function generateEmptyMazeWithCoins(width, height) {
  const maze = generateEmptyMaze(width, height);
  const rng = Math.random;
  const coins = generateCoins(maze, width, height, rng); // Use your existing generateCoins function
  return { maze, coins };
}

// Start the game
function handleStartGame(roomId) {
  const room = rooms[roomId];
  if (!room || room.players.length < 2) {
    console.log("Not enough players to start the game.");
    return;
  }

  // Prevent re-starting the game
  if (room.isGameStarted) {
    console.log(`Game in room ${roomId} is already started.`);
    return;
  }

  room.isGameStarted = true;

  // Generate the maze and exit only once
  const { maze, coins, exit } = generateMaze(15, 15, Math.random());
  room.maze = maze; // Store the maze for this room
  room.coins = coins; // Store the coins
  room.exit = exit; // Store the exit

  console.log(`Exit placed at (${exit.x}, ${exit.y}).`);

  const initialPositions = room.players.map((player) => {
    let x, y;
    do {
      x = Math.floor(Math.random() * 15);
      y = Math.floor(Math.random() * 15);
    } while (maze[y][x] !== 0); // Find a valid starting position
    return { playerId: player.playerId, x, y };
  });

  room.players.forEach((player, index) => {
    player.x = initialPositions[index].x;
    player.y = initialPositions[index].y;
  });

  room.players.forEach((player) => {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(
        JSON.stringify({
          type: "start-game",
          positions: initialPositions,
          maze, // Send the same maze
          coins, // Send the same coins
          exit, // Send the correct exit
        })
      );
    }
  });

  console.log(
    `Game started in room ${roomId} with exit at (${exit.x}, ${exit.y}).`
  );
}

function handlePlayerMove({ roomId, playerId, position }) {
  const room = rooms[roomId];
  if (!room) return;

  const { x, y } = position;
  const { exit } = room;

  console.log(`Player ${playerId} moved to (${x}, ${y}) in room ${roomId}.`);

  // Check if the player has reached the exit
  if (x === exit.x && y === exit.y) {
    if (!room.finishedPlayers.includes(playerId)) {
      room.finishedPlayers.push(playerId);

      // Assign bonus points
      const finishOrder = room.finishedPlayers.length;
      const bonusPoints = 50 - (finishOrder - 1) * 10; // Decrease 10 points per rank
      room.scores[playerId] = (room.scores[playerId] || 0) + bonusPoints;

      console.log(
        `Player ${playerId} reached the exit at (${exit.x}, ${exit.y}) and received ${bonusPoints} points.`
      );

      // Broadcast updated leaderboard
      broadcastLeaderboard(roomId, false);
    }

    // Check if all players have finished
    if (room.finishedPlayers.length === room.players.length) {
      broadcastLeaderboard(roomId, true); // Send final leaderboard
    }
  }

  // Broadcast player movement to the room
  broadcastToRoom(roomId, {
    type: "player-move",
    playerId,
    position,
  });
}

// Broadcast the final leaderboard to all players

// Handle joining a room
function handleJoinRoom(ws, { roomId, name, avatar, playerId }) {
  if (!rooms[roomId]) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Room not found.",
      })
    );
    return;
  }

  const room = rooms[roomId];
  room.players.push({ playerId, name, avatar, ws });

  // Send current state to the new player
  ws.send(
    JSON.stringify({
      type: "room-update",
      players: room.players.map((p) => ({
        playerId: p.playerId,
        name: p.name,
        avatar: p.avatar,
      })),
      selectedAvatars: Array.from(room.selectedAvatars),
    })
  );

  // Notify others of the new player
  broadcastToRoom(roomId, {
    type: "room-update",
    players: room.players.map((p) => ({
      playerId: p.playerId,
      name: p.name,
      avatar: p.avatar,
    })),
    selectedAvatars: Array.from(room.selectedAvatars),
  });
}

// Handle final scores
function handleFinalScore({ roomId, playerId, score }) {
  const room = rooms[roomId];
  if (!room) return;

  // Store the player's final score
  room.scores[playerId] = score;

  console.log(`Final score received: Player ${playerId} - ${score}`);

  // Check if all players have submitted their scores
  if (Object.keys(room.scores).length === room.players.length) {
    // Create and broadcast the final leaderboard
    const leaderboard = room.players
      .map((player) => ({
        playerId: player.playerId,
        name: player.name,
        score: room.scores[player.playerId] || 0,
      }))
      .sort((a, b) => b.score - a.score); // Sort by score descending

    broadcastToRoom(roomId, {
      type: "leaderboard",
      leaderboard,
    });

    console.log("Final leaderboard broadcasted:", leaderboard);
  }
}

// Broadcast a message to all players in a room
function broadcastToRoom(roomId, message) {
  const room = rooms[roomId];
  if (!room) return;

  room.players.forEach((player) => {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(JSON.stringify(message));
    }
  });
}

// Handle player progress updates
function handleProgressUpdate({ roomId, playerId, progress }) {
  const room = rooms[roomId];
  if (!room) return;

  const player = room.players.find((p) => p.playerId === playerId);
  if (player) {
    // Update player's progress
    player.progress = {
      coinsCollected: progress.coinsCollected,
      completionPercentage: progress.completionPercentage,
      timeRemaining: progress.timeRemaining, // New field
    };

    console.log(`Progress update for Player ${playerId}:`, player.progress);

    // Broadcast progress update to all players in the room
    broadcastToRoom(roomId, {
      type: "progress-update",
      playerId,
      progress: player.progress,
    });
  }
}

// Handle player disconnect
function handleDisconnect(ws) {
  Object.keys(rooms).forEach((roomId) => {
    const room = rooms[roomId];
    if (!room) return;

    // Find the disconnected player
    const disconnectedPlayer = room.players.find((player) => player.ws === ws);

    if (disconnectedPlayer) {
      console.log(
        `Player ${disconnectedPlayer.name} disconnected from room ${roomId}`
      );

      // Remove the player from the room
      room.players = room.players.filter((player) => player.ws !== ws);

      // Check if the room is empty
      if (room.players.length === 0) {
        setTimeout(() => {
          if (rooms[roomId] && rooms[roomId].players.length === 0) {
            delete rooms[roomId];
            console.log(`Room ${roomId} deleted because it is empty.`);
          }
        }, 5000); // Wait 5 seconds before deleting the room
      } else {
        // Update the leaderboard and notify remaining players
        updateLeaderboard(roomId);

        // Notify remaining players of the updated room state
        broadcastToRoom(roomId, {
          type: "room-update",
          players: room.players.map((player) => ({
            playerId: player.playerId,
            name: player.name,
            avatar: player.avatar,
          })),
        });
      }
    }
  });
}

function updateLeaderboard(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  // Sort players by score in descending order
  const leaderboard = room.players
    .map((player) => ({
      playerId: player.playerId,
      name: player.name,
      score: player.score, // Ensure scores are up-to-date
    }))
    .sort((a, b) => b.score - a.score);

  // Broadcast the updated leaderboard
  broadcastToRoom(roomId, {
    type: "leaderboard-update",
    leaderboard,
  });

  console.log(`Leaderboard updated for room ${roomId}:`, leaderboard);
}

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
