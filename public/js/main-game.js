// Add hashCode method to String prototype
if (!String.prototype.hashCode) {
  String.prototype.hashCode = function () {
    let hash = 0;
    for (let i = 0; i < this.length; i++) {
      const char = this.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // Convert to 32-bit integer
    }
    return hash;
  };
}

import { generateMaze } from "./maze.js";

const socket = new WebSocket("ws://localhost:3000");
let players = {};
let gameStartTime; // Declare globally
let localPlayerId = Math.random().toString(36).substring(2, 7); // Unique ID for this player
let mazeGrid, exitPosition, coins;
let canvas, ctx;
let gameTimer;
let countdownStarted = false;
let gameDuration = 60;
let coinsCollected = 0;
let gameEnded = false;
const peerConnections = {};
const dataChannels = {};

// Store the last processed timestamp for each player to avoid outdated updates
const lastTimestamps = {};

// WebRTC configuration
const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

// DOM Elements
const nameModal = document.getElementById("nameModal");
const avatarModal = document.getElementById("avatarModal");
const waitingRoomModal = document.getElementById("waitingRoomModal");
const gameContainer = document.getElementById("gameContainer");
const playerListContainer = document.getElementById("playerListContainer");
const countdownElement = document.getElementById("countdown");
const timerElement = document.getElementById("timer");

// Initial State
let playerName = "";
let avatar = "";

// Hero avatars
const heroImages = {};
const heroPaths = [
  "asset/images/hero1.png",
  "asset/images/hero2.png",
  "asset/images/hero3.png",
  "asset/images/hero4.png",
  "asset/images/hero5.png",
  "asset/images/hero6.png",
  "asset/images/hero7.png",
  "asset/images/hero8.png",
  "asset/images/hero9.png",
  "asset/images/hero10.png",
  "asset/images/hero11.png",
  "asset/images/hero12.png",
];
heroPaths.forEach((path, index) => {
  const img = new Image();
  img.src = path;
  img.onload = () => console.log(`Hero image loaded: ${path}`);
  heroImages[`hero${index + 1}`] = img;
});

// URL Params
const urlParams = new URLSearchParams(window.location.search);
const roomId =
  urlParams.get("roomId") || Math.random().toString(36).substring(2, 10);
const isSpectator = urlParams.get("spectator") === "true";

// Show name modal if not a spectator
if (!isSpectator) {
  nameModal.style.display = "flex";
}

// Function to update Room ID display
function updateRoomIdDisplay() {
  // Update Room ID in Create Room page
  const roomIdCreate = document.getElementById("roomIdCreate");
  if (roomIdCreate) {
    roomIdCreate.textContent = roomId;
  }

  // Update Room ID in Waiting Room modal
  const roomIdWaiting = document.getElementById("roomIdWaiting");
  if (roomIdWaiting) {
    roomIdWaiting.textContent = roomId;
  }

  // Update Room ID in Maze Room
  const roomIdMaze = document.getElementById("roomIdMaze");
  if (roomIdMaze) {
    roomIdMaze.textContent = roomId;
  }
}

// Call the function to update Room ID
updateRoomIdDisplay();

// Proceed to avatar selection
function proceedToAvatarSelection() {
  playerName = document.getElementById("playerNameInput").value.trim();
  if (!playerName) {
    alert("Please enter your name.");
    return;
  }

  nameModal.style.display = "none";
  avatarModal.style.display = "flex";

  // Display avatars
  const avatarContainer = document.getElementById("avatarContainer");
  avatarContainer.innerHTML = ""; // Clear existing avatars

  heroPaths.forEach((path, index) => {
    const img = document.createElement("img");
    const avatarId = `hero${index + 1}`;
    img.src = path;
    img.alt = avatarId;

    // Check if avatar is already selected
    if (Object.values(players).some((player) => player.avatar === avatarId)) {
      img.style.opacity = "0.5";
      img.style.cursor = "not-allowed";
      img.onclick = null; // Disable click event
    } else {
      img.style.opacity = "1"; // Ensure opacity is reset for available avatars
      img.style.cursor = "pointer";
      img.onclick = () => {
        // Send a request to check avatar availability
        socket.send(
          JSON.stringify({
            type: "check-avatar",
            roomId,
            avatar: avatarId,
            playerId: localPlayerId,
          })
        );

        // Listen for the server's response
        const onAvatarCheck = (event) => {
          const data = JSON.parse(event.data);

          if (data.type === "avatar-status" && data.avatarId === avatarId) {
            if (data.isAvailable) {
              // Avatar is available
              avatar = avatarId;
              img.style.opacity = "0.5";
              img.style.cursor = "not-allowed";
              avatarModal.style.display = "none";
              alert(`Avatar "${avatarId}" selected.`);

              // Notify the server of the final selection
              socket.send(
                JSON.stringify({
                  type: "avatar-selected",
                  playerId: localPlayerId,
                  avatar: avatarId,
                  roomId,
                })
              );

              // Move to waiting room
              joinWaitingRoom();
              showWaitingRoomModal();
            } else {
              // Avatar is already selected
              alert(
                `Avatar "${avatarId}" is already selected. Please choose another.`
              );
            }
          }
        };

        // Attach event listener
        socket.addEventListener("message", onAvatarCheck);
      };
    }
    avatarContainer.appendChild(img);
  });
}

// Function to display waiting room modal
function showWaitingRoomModal() {
  const waitingRoomModal = document.getElementById("waitingRoomModal");
  const playersListContainer = document.getElementById("playersListContainer");
  playersListContainer.innerHTML = ""; // Clear previous player list

  Object.values(players).forEach((player) => {
    const playerDiv = document.createElement("div");
    playerDiv.textContent = player.name;
    const playerAvatar = document.createElement("img");
    playerAvatar.src =
      heroPaths[parseInt(player.avatar.replace("hero", "")) - 1];
    playerAvatar.alt = player.avatar;

    playerDiv.appendChild(playerAvatar);
    playersListContainer.appendChild(playerDiv);
  });

  waitingRoomModal.style.display = "block";
}

window.proceedToAvatarSelection = proceedToAvatarSelection;

// Create a new peer connection and data channel
function createPeerConnection(peerId) {
  const peerConnection = new RTCPeerConnection(rtcConfig);

  // Create a data channel for sending movement updates
  const dataChannel = peerConnection.createDataChannel("movement");
  dataChannels[peerId] = dataChannel;

  // Set up data channel handlers
  setupDataChannelHandlers(dataChannel, peerId);

  // Handle ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.send(
        JSON.stringify({
          type: "signal",
          action: "ice-candidate",
          sender: localPlayerId,
          receiver: peerId,
          candidate: event.candidate,
        })
      );
    }
  };

  // Handle incoming data channels
  peerConnection.ondatachannel = (event) => {
    const remoteDataChannel = event.channel;
    setupDataChannelHandlers(remoteDataChannel, peerId);
  };

  peerConnections[peerId] = peerConnection;
  return peerConnection;
}

function broadcastCoinCollection(playerId, coinPosition) {
  Object.values(dataChannels).forEach((channel, peerId) => {
    if (channel.readyState === "open") {
      channel.send(
        JSON.stringify({
          type: "coin-collected",
          playerId,
          coinPosition,
        })
      );
      console.log(
        `Broadcasted coin collection to peer ${peerId}:`,
        coinPosition
      );
    } else {
      console.warn(`DataChannel to peer ${peerId} is not open.`);
    }
  });
}

// Join waiting room
function joinWaitingRoom() {
  if (Object.values(players).some((player) => player.avatar === avatar)) {
    alert("Avatar already chosen, select another.");
    avatarModal.style.display = "flex";
    return;
  }

  waitingRoomModal.style.display = "flex";
  socket.send(
    JSON.stringify({
      type: "join-room",
      roomId,
      playerId: localPlayerId,
      name: playerName,
      avatar,
    })
  );
}
window.joinWaitingRoom = joinWaitingRoom;

// WebSocket setup
socket.onopen = () => console.log("WebSocket connected.");
// Handle WebSocket messages for signaling
socket.onmessage = async (event) => {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case "update-coins":
      handleCoinUpdate(data.coins);
      break;
    case "progress-update":
      updateProgressDisplay(data.playerId, data.progress);
      break;
    case "room-update":
      updateWaitingRoom(data.players);
      break;
    case "start-game":
      startGame(data);
      break;
    case "avatar-update":
      updateAvatarModal(data.players, data.selectedAvatars);
      break;
    case "avatar-selection-error":
      alert(data.message);
      break;
    case "show-leaderboard":
      showLeaderboardModal(); // Trigger leaderboard modal
      break;
    case "leaderboard":
      console.log("Received leaderboard data:", data.leaderboard);
      displayLeaderboard(data.leaderboard, data.isFinal);
      break;
    case "signal":
      await handleSignaling(data);
      break;
    case "final-scores":
      displayLeaderboard(data.scores, true); // Display final scores
      break;
    case "player-disconnected":
      handlePlayerDisconnection(data.playerId);
      break;
    default:
      console.log("Unknown message type:", data.type);
  }
};

// Initialize WebRTC connections
async function initWebRTCConnections() {
  for (const player of Object.values(players)) {
    if (player.playerId === localPlayerId) continue;

    // Create PeerConnection for each player
    const peerConnection = new RTCPeerConnection(rtcConfig);
    peerConnections[player.playerId] = peerConnection;

    // Create DataChannel for P2P communication
    const dataChannel = peerConnection.createDataChannel("movement");
    dataChannels[player.playerId] = dataChannel;

    // Handle incoming ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.send(
          JSON.stringify({
            type: "signal",
            action: "ice-candidate",
            roomId,
            sender: localPlayerId,
            receiver: player.playerId,
            candidate: event.candidate,
          })
        );
      }
    };

    // Handle incoming DataChannel messages
    dataChannel.onmessage = (event) => {
      const { playerId, position } = JSON.parse(event.data);
      updatePlayerPosition(playerId, position);
    };

    // Create WebRTC offer
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    // Send offer to the other player
    socket.send(
      JSON.stringify({
        type: "signal",
        action: "offer",
        roomId,
        sender: localPlayerId,
        receiver: player.playerId,
        offer,
      })
    );
  }
}

function showLeaderboardModal() {
  const leaderboardModal = document.getElementById("leaderboardModal");
  leaderboardModal.style.display = "block"; // Ensure the modal is visible
  console.log("Leaderboard modal displayed.");
}

function updateAvatarSelectionUI() {
  const avatarContainer = document.getElementById("avatarContainer");
  if (!avatarContainer) return;

  // Update avatars' opacity and interactivity
  Array.from(avatarContainer.children).forEach((img) => {
    const avatarId = img.alt;
    if (Object.values(players).some((player) => player.avatar === avatarId)) {
      img.style.opacity = "0.5";
      img.style.cursor = "not-allowed";
      img.onclick = null; // Disable click
    } else {
      img.style.opacity = "1";
      img.style.cursor = "pointer";
      img.onclick = () => {
        avatar = avatarId;
        img.style.opacity = "0.5";
        img.style.cursor = "not-allowed";
        avatarModal.style.display = "none";

        alert(`Avatar "${avatarId}" selected.`);
        joinWaitingRoom();

        // Notify the server about the selection
        socket.send(
          JSON.stringify({
            type: "avatar-selected",
            playerId: localPlayerId,
            avatar: avatarId,
          })
        );
      };
    }
  });
}

function updateAvatarModal(players, selectedAvatars) {
  const avatarContainer = document.getElementById("avatarContainer");
  avatarContainer.innerHTML = ""; // Clear current avatars

  heroPaths.forEach((path, index) => {
    const avatarId = `hero${index + 1}`;
    const img = document.createElement("img");
    img.src = path;
    img.alt = avatarId;

    // Disable avatars already selected
    if (selectedAvatars && selectedAvatars.includes(avatarId)) {
      img.style.opacity = "0.5";
      img.style.cursor = "not-allowed";
      img.onclick = null; // Disable click
    } else {
      img.style.opacity = "1";
      img.style.cursor = "pointer";
      img.onclick = () => {
        avatar = avatarId;
        img.style.opacity = "0.5";
        img.style.cursor = "not-allowed";
        avatarModal.style.display = "none";

        // Notify the server about avatar selection
        socket.send(
          JSON.stringify({
            type: "avatar-selected",
            playerId: localPlayerId,
            roomId,
            avatar: avatarId,
          })
        );

        alert(`Avatar "${avatarId}" selected.`);
      };
    }

    avatarContainer.appendChild(img);
  });
}

function selectAvatar(avatarId) {
  avatar = avatarId;

  socket.send(
    JSON.stringify({
      type: "avatar-selected",
      playerId: localPlayerId,
      roomId,
      avatar: avatarId,
    })
  );

  alert(`Avatar "${avatarId}" selected.`);
}

function handlePlayerMove(x, y) {
  console.log(`handlePlayerMove called with position (${x}, ${y})`);

  const player = players[localPlayerId];
  if (!player || gameEnded) return;

  player.x = x;
  player.y = y;

  // Check if the player has reached the exit
  if (x === exitPosition.x && y === exitPosition.y) {
    console.log(`Player ${localPlayerId} reached the exit at (${x}, ${y})!`);

    // Notify the server
    socket.send(
      JSON.stringify({
        type: "player-finished",
        roomId,
        playerId: localPlayerId,
        score: players[localPlayerId].score || 0, // Send current score
      })
    );

    gameEnded = true; // Prevent further movement
  }
}

// Send Final Score to Server
function sendFinalScore() {
  const finalScore = players[localPlayerId]?.score || 0;

  if (socket.readyState === WebSocket.OPEN) {
    socket.send(
      JSON.stringify({
        type: "final-score",
        roomId,
        playerId: localPlayerId,
        name: playerName,
        score: finalScore, // Send the correct score
      })
    );
    console.log(`Sent final score to server: ${finalScore}`);
  } else {
    console.warn("WebSocket is not open. Unable to send final score.");
  }
}

// Handle WebRTC signaling (offer/answer/ICE candidates)
async function handleSignaling(data) {
  const { sender, receiver, action } = data;

  // Ignore signals not meant for this player
  if (receiver !== localPlayerId) return;

  const peerConnection =
    peerConnections[sender] || new RTCPeerConnection(rtcConfig);
  peerConnections[sender] = peerConnection;

  if (action === "offer") {
    await peerConnection.setRemoteDescription(
      new RTCSessionDescription(data.offer)
    );
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.send(
      JSON.stringify({
        type: "signal",
        action: "answer",
        roomId,
        sender: localPlayerId,
        receiver: sender,
        answer,
      })
    );
  } else if (action === "answer") {
    await peerConnection.setRemoteDescription(
      new RTCSessionDescription(data.answer)
    );
  } else if (action === "ice-candidate") {
    peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
  }
}

// Broadcast movement to all peers via WebRTC
function broadcastMovement(position) {
  Object.values(dataChannels).forEach((channel, peerId) => {
    if (channel.readyState === "open") {
      channel.send(
        JSON.stringify({
          type: "player-move",
          playerId: localPlayerId,
          position,
        })
      );
      console.log(`Broadcasted movement to peer ${peerId}:`, position);
    } else {
      console.warn(`DataChannel to peer ${peerId} is not open.`);
    }
  });
}

// Update player position locally
function updatePlayerPosition(playerId, position) {
  if (players[playerId]) {
    players[playerId].x = position.x;
    players[playerId].y = position.y;

    // Redraw the maze to reflect all players
    // drawMaze(canvas.width / mazeGrid[0].length);

    // Refresh the player list
    updatePlayerList();

    console.log(`Updated position for player ${playerId}:`, position);
  }
}

// Update waiting room
function updateWaitingRoom(playersData) {
  players = playersData.reduce((acc, player) => {
    acc[player.playerId] = {
      ...player,
      score: player.score || 0, // Initialize score to 0 if not set
    };
    return acc;
  }, {});

  playerListContainer.innerHTML = "";
  playersData.forEach(({ name, avatar }) => {
    const playerDiv = document.createElement("div");
    playerDiv.innerHTML = `
      <img src="asset/images/${avatar}.png" alt="${name}" width="50" height="50">
      <span>${name}</span>
    `;
    playerListContainer.appendChild(playerDiv);
  });

  if (playersData.length >= 2 && !countdownStarted) {
    startCountdown();
  }
}

// Countdown before starting the game
function startCountdown() {
  countdownStarted = true;
  let countdown = 30; // Adjustable countdown time

  const interval = setInterval(() => {
    countdown--;
    countdownElement.textContent = `Game starts in: ${countdown} seconds`;

    if (countdown <= 0) {
      clearInterval(interval);
      socket.send(JSON.stringify({ type: "start-game", roomId }));
    }
  }, 1000);
}

socket.on("start-game", (data) => {
  mazeGrid = data.maze;
  data.positions.forEach(({ playerId, x, y }) => {
    if (!players[playerId]) {
      players[playerId] = { x, y, playerId };
    } else {
      players[playerId].x = x;
      players[playerId].y = y;
    }
  });
  initializeMaze();
  console.log("Initialized game with maze and positions:", mazeGrid, players);
});

// Start the game
function startGame(data) {
  waitingRoomModal.style.display = "none";
  gameContainer.style.display = "block";

  // Assign the maze data received from the server
  mazeGrid = data.maze; // Use the maze sent from the server
  exitPosition = data.exit; // Use the exit coordinates sent from the server
  coins = data.coins; // Use the coins sent from the server

  console.log(
    `Maze initialized with exit at (${exitPosition.x}, ${exitPosition.y}).`
  );

  // Set player positions
  data.positions.forEach(({ playerId, x, y }) => {
    if (!players[playerId]) {
      // Initialize new player
      players[playerId] = { x, y, playerId };
    } else {
      // Ensure the position is only updated during game start
      if (!gameStartTime) {
        players[playerId].x = x;
        players[playerId].y = y;
      }
    }
  });

  initializeMaze();
  setupPlayerControls();
  startGameTimer();
  // Initialize the player list
  updatePlayerList();
}

// Handle new player joining
function handleNewPlayer(playerId) {
  const peerConnection = new RTCPeerConnection(rtcConfig);
  peerConnections[playerId] = peerConnection;

  const dataChannel = peerConnection.createDataChannel("movement");
  dataChannels[playerId] = dataChannel;

  setupDataChannelHandlers(dataChannel, playerId);

  // Send the current game state to the new player
  dataChannel.onopen = () => {
    const gameState = {
      type: "game-state",
      maze: mazeGrid,
      players: Object.values(players).map(({ x, y, playerId }) => ({
        x,
        y,
        playerId,
      })),
    };
    dataChannel.send(JSON.stringify(gameState));
  };

  // Handle incoming offer/answer/ICE candidates via WebSocket signaling
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.send(
        JSON.stringify({
          type: "signal",
          action: "ice-candidate",
          sender: localPlayerId,
          receiver: playerId,
          candidate: event.candidate,
        })
      );
    }
  };
}

function updateProgress() {
  if (!gameStartTime) return; // Ensure the game has started
  const progress = {
    coinsCollected: players[localPlayerId]?.score || 0,
    completionPercentage: calculateCompletionPercentage(),
    timeRemaining: getTimeRemaining(),
  };

  if (socket.readyState === WebSocket.OPEN) {
    socket.send(
      JSON.stringify({
        type: "progress-update",
        roomId,
        playerId: localPlayerId,
        progress,
      })
    );
    console.log(`Sent progress update:`, progress);
  }
}

// Helper to calculate time remaining
function getTimeRemaining() {
  return Math.max(
    0,
    gameDuration - Math.floor((Date.now() - gameStartTime) / 1000)
  );
}

function updateScores() {
  const leaderboard = Object.values(players)
    .map((player) => ({
      name: player.name,
      score: player.score,
    }))
    .sort((a, b) => b.score - a.score); // Sort by descending score

  // Update the leaderboard in progressContainer
  displayLeaderboard(leaderboard, false);
}

// Notify server when collecting a coin
function collectCoin(playerId, x, y) {
  const coinIndex = coins.findIndex((coin) => coin.x === x && coin.y === y);

  if (coinIndex !== -1) {
    coins.splice(coinIndex, 1); // Update local coins for immediate feedback
    if (!players[playerId].score) players[playerId].score = 0;
    players[playerId].score += 10; // Increment score locally
    //if (playerId === localPlayerId) {
    updateScoreUI();
    updateProgress(); // Send updated progress
    drawMaze(canvas.width / mazeGrid[0].length);
    broadcastCoinCollection(playerId, { x, y });

    // Notify the server
    socket.send(
      JSON.stringify({
        type: "coin-collected",
        roomId,
        playerId,
        coinPosition: { x, y },
        score: players[playerId].score, // Send updated score
      })
    );
    //}
  }
}

// Helper to calculate maze completion percentage
function calculateCompletionPercentage() {
  const totalCells = mazeGrid.flat().length;
  const visitedCells = mazeGrid.flat().filter((cell) => cell === 2).length; // Assuming 2 marks visited cells
  return Math.floor((visitedCells / totalCells) * 100);
}

// Handle incoming game state
function handleGameState(data) {
  mazeGrid = data.maze;
  data.players.forEach(({ playerId, x, y }) => {
    if (!players[playerId]) {
      players[playerId] = { x, y, playerId };
    } else {
      players[playerId].x = x;
      players[playerId].y = y;
    }
  });
  drawMaze(canvas.width / mazeGrid[0].length);
}

// Display Leaderboard
function displayLeaderboard(leaderboard, isFinal) {
  console.log("Displaying leaderboard:", leaderboard);

  // Progress container setup
  const progressContainer = document.getElementById("progressContainer");
  progressContainer.innerHTML = ""; // Clear content

  // Modal elements
  const leaderboardModal = document.getElementById("leaderboardModal");
  const leaderboardTableBody = document.querySelector("#leaderboard tbody");
  const leaderboardTitle = document.getElementById("leaderboardTitle");
  leaderboardTableBody.innerHTML = ""; // Clear modal rows

  // Title text
  const titleText = isFinal ? "Final Standings" : "Current Standings";
  leaderboardTitle.textContent = titleText;

  // Create leaderboard table for progress container
  const table = document.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";

  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr>
      <th>Rank</th>
      <th>Player</th>
      <th>Score</th>
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  leaderboard.forEach((player, index) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${player.name}</td>
      <td>${player.score || 0}</td>
    `;
    tbody.appendChild(row);

    // Add rows to modal as well
    const modalRow = row.cloneNode(true);
    leaderboardTableBody.appendChild(modalRow);
  });
  table.appendChild(tbody);
  progressContainer.appendChild(table);

  // Add title to progress container
  const title = document.createElement("h2");
  title.textContent = titleText;
  progressContainer.prepend(title);

  // Display modal if it's final standings
  if (isFinal) {
    leaderboardModal.style.display = "block";
  }

  console.log("Leaderboard updated successfully.");
}

// Helper function to create the leaderboard table
function createLeaderboardTable(leaderboard) {
  const table = document.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";

  // Add table headers
  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr>
      <th>Rank</th>
      <th>Player</th>
      <th>Score</th>
    </tr>
  `;
  table.appendChild(thead);

  // Add rows for each player
  const tbody = document.createElement("tbody");
  leaderboard.forEach((player, index) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${player.name}</td>
      <td>${player.score}</td>
    `;
    tbody.appendChild(row);
  });
  table.appendChild(tbody);

  return table;
}

window.closeLeaderboard = function () {
  document.getElementById("leaderboardModal").style.display = "none";
};

// Handle incoming data in setupDataChannelHandlers
function setupDataChannelHandlers(dataChannel, peerId) {
  dataChannel.onmessage = (event) => {
    const data = JSON.parse(event.data);

    switch (data.type) {
      case "progress-update":
        updateProgressDisplay(data.playerId, data.progress);
        break;

      case "player-move":
        updatePlayerPosition(data.playerId, data.position);
        break;

      case "coin-collected":
        removeCoinFromMaze(data.coinPosition);
        if (data.playerId === localPlayerId) {
          updateScore(data.playerId); // Update local player's score
        }
        break;

      case "final-score":
        handleFinalScore(data);
        break;

      default:
        console.warn(`Unknown message type from peer ${peerId}:`, data.type);
    }
  };

  dataChannel.onopen = () =>
    console.log(`Data channel with peer ${peerId} is open.`);
  dataChannel.onclose = () =>
    console.log(`Data channel with peer ${peerId} is closed.`);
}

// Update progress display
function updateProgressDisplay(playerId, progress) {
  const player = players[playerId];
  if (player) {
    player.progress = progress; // Update local player data
    console.log(`Progress received for Player ${playerId}:`, progress);

    // Update the leaderboard or progress bar UI
    updateLeaderboardUI();
  }
}

// Update the score display for the collecting player
function updateScore(playerId) {
  if (players[playerId]) {
    players[playerId].score += 10; // Increment score
    if (playerId === localPlayerId) {
      updateScoreUI();
    }
  }
}

// Remove the coin from the local maze
function removeCoinFromMaze(coinPosition) {
  const coinIndex = coins.findIndex(
    (coin) => coin.x === coinPosition.x && coin.y === coinPosition.y
  );

  if (coinIndex !== -1) {
    coins.splice(coinIndex, 1); // Remove coin
    drawMaze(canvas.width / mazeGrid[0].length); // Redraw maze
    console.log(`Coin removed at position: ${JSON.stringify(coinPosition)}`);
  }
}

// Handle updated coin state
function handleCoinUpdate(updatedCoins) {
  //coins = updatedCoins; // Update the local coins array
  drawMaze(canvas.width / mazeGrid[0].length); // Redraw the maze
  console.log("Updated coins received from server:", coins);
}

function handleFinalScore(data) {
  const { playerId, name, score } = data;

  if (!players[playerId]) {
    players[playerId] = {
      playerId,
      name,
      score,
    };
  } else {
    // Ensure the higher score is retained
    players[playerId].score = Math.max(players[playerId].score || 0, score);
  }

  console.log(
    `Received final score from player ${playerId}:`,
    players[playerId].score
  );
  updateLeaderboardUI(); // Refresh the leaderboard UI with the updated scores
}

function updateLeaderboardUI() {
  const leaderboardTableBody = document.querySelector("#leaderboard tbody");
  const progressContainer = document.getElementById("progressContainer");

  leaderboardTableBody.innerHTML = ""; // Clear existing leaderboard rows
  progressContainer.innerHTML = ""; // Clear existing progress list

  // Sort players by score in descending order
  const sortedPlayers = Object.values(players).sort(
    (a, b) => b.score - a.score
  );

  // Create the Player Progress table
  const progressTable = document.createElement("table");
  progressTable.style.width = "100%";
  progressTable.style.borderCollapse = "collapse";
  progressTable.innerHTML = `
    <thead>
      <tr>
        <th>Avatar</th>
        <th>Player</th>
        <th>Coins Collected</th>
        <th>Time Left (s)</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  // Populate progress list
  const progressTableBody = progressTable.querySelector("tbody");
  sortedPlayers.forEach((player) => {
    const row = document.createElement("tr");
    row.style.borderBottom = "1px solid #ddd";

    row.innerHTML = `
      <td style="text-align: center">
        <img src="asset/images/${player.avatar}.png" alt="${
      player.name
    }" width="50" height="50" style="border-radius: 50%;">
      </td>
      <td>${player.name}</td>
      <td>${player.progress?.coinsCollected || 0}</td>
      <td>${player.progress?.timeRemaining || 0}</td>
    `;

    progressTableBody.appendChild(row);
  });

  progressContainer.appendChild(progressTable);
}

function updatePlayerList() {
  const playerListElement = document.getElementById("playerList");
  if (!playerListElement) {
    console.warn("Player list element not found. Skipping update.");
    return;
  }

  // Clear existing player list
  playerListElement.innerHTML = "";

  // Populate with remaining players
  Object.values(players).forEach((player) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <img 
          src="asset/images/${player.avatar}.png" 
          alt="${player.name}" 
          width="50" 
          height="50" 
          style="border-radius: 50%;"
        />
      </td>
      <td>${player.name}</td>
    `;
    playerListElement.appendChild(row);
  });
}

function handleCoinCollected(playerId, coinPosition) {
  // Remove the coin from the maze
  const coinIndex = coins.findIndex(
    (coin) => coin.x === coinPosition.x && coin.y === coinPosition.y
  );

  if (coinIndex !== -1) {
    coins.splice(coinIndex, 1);

    // Update the score of the player who collected the coin
    players[playerId].score += 10;

    console.log(
      `Coin collected by Player ${playerId}. New Score: ${players[playerId].score}`
    );

    // Redraw the maze to reflect the removed coin
    drawMaze(canvas.width / mazeGrid[0].length);
  }
}

// Initialize the maze
function initializeMaze() {
  canvas = document.getElementById("mazeCanvas");
  ctx = canvas.getContext("2d");

  const cellSize = canvas.width / mazeGrid[0].length;
  drawMaze(cellSize);
}

// Draw maze and related elements
function drawMaze(cellSize) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  mazeGrid.forEach((row, y) => {
    row.forEach((cell, x) => {
      ctx.fillStyle = cell === 1 ? "black" : "white";
      ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
    });
  });

  drawExit(cellSize);
  drawCoins(cellSize);
  drawPlayers(cellSize); // Draw remaining players
}

// Helper to draw exit
function drawExit(cellSize) {
  ctx.fillStyle = "green";
  ctx.fillRect(
    exitPosition.x * cellSize,
    exitPosition.y * cellSize,
    cellSize,
    cellSize
  );
}

// Helper to draw coins
function drawCoins(cellSize) {
  coins.forEach((coin) => {
    ctx.fillStyle = "gold";
    ctx.beginPath();
    ctx.arc(
      coin.x * cellSize + cellSize / 2,
      coin.y * cellSize + cellSize / 2,
      cellSize / 4,
      0,
      2 * Math.PI
    );
    ctx.fill();
  });
}

// Helper to draw players
function drawPlayers(cellSize) {
  Object.values(players).forEach((player) => {
    const heroImg = heroImages[player.avatar];
    if (heroImg) {
      ctx.drawImage(
        heroImg,
        player.x * cellSize,
        player.y * cellSize,
        cellSize,
        cellSize
      );
    } else {
      console.warn(`Avatar image not found for player: ${player.name}`);
    }
  });
}

function updateScoreUI() {
  const scoreElement = document.getElementById("score");
  scoreElement.textContent = `Score: ${players[localPlayerId].score}`;
}

// Player controls (update to use WebRTC for broadcasting movement)
function setupPlayerControls() {
  const pressedKeys = new Set();

  document.addEventListener("keydown", (event) => {
    if (pressedKeys.has(event.key)) return; // Ignore repeated keys
    pressedKeys.add(event.key);

    const player = players[localPlayerId];
    if (!player || gameEnded) return;

    let { x, y } = player;

    // Move based on keypress
    if (event.key === "ArrowUp" && mazeGrid[y - 1]?.[x] === 0) y--;
    if (event.key === "ArrowDown" && mazeGrid[y + 1]?.[x] === 0) y++;
    if (event.key === "ArrowLeft" && mazeGrid[y]?.[x - 1] === 0) x--;
    if (event.key === "ArrowRight" && mazeGrid[y]?.[x + 1] === 0) x++;

    // Update player position
    player.x = x;
    player.y = y;

    // Log the player's new position
    console.log(`Player moved to (${x}, ${y})`);

    // Handle collecting coins or reaching the exit
    collectCoin(localPlayerId, x, y);
    handlePlayerMove(x, y);

    // Update the maze and broadcast movement
    broadcastMovement({ x, y });
    drawMaze(canvas.width / mazeGrid[0].length);
  });

  document.addEventListener("keyup", (event) => {
    pressedKeys.delete(event.key);
  });
}

// Handle player disconnection
function handlePlayerDisconnection(playerId) {
  console.log(`Player ${playerId} disconnected.`);

  // Remove the player from the players object
  if (players[playerId]) {
    delete players[playerId];
    console.log(`Removed player ${playerId} from players list.`);
  } else {
    console.warn(`Player ${playerId} not found in players list.`);
  }

  // Remove their associated progress from the progress table
  updateProgressContainer();

  // Redraw the maze to remove their avatar
  drawMaze(canvas.width / mazeGrid[0].length);

  // Notify peers about the disconnection
  broadcastPlayerDisconnection(playerId);
}

// Update the progress table dynamically
function updateProgressContainer() {
  const progressContainer = document.getElementById("progressContainer");
  progressContainer.innerHTML = ""; // Clear the existing progress container

  // Create the table structure
  const progressTable = document.createElement("table");
  progressTable.style.width = "100%";
  progressTable.style.borderCollapse = "collapse";

  // Add the header (thead)
  progressTable.innerHTML = `
    <thead>
      <tr>
        <th style="text-align: center;">Avatar</th>
        <th>Player</th>
        <th>Coins Collected</th>
        <th>Time Left (s)</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  // Get the tbody for adding player rows
  const progressTableBody = progressTable.querySelector("tbody");

  // Populate progress rows
  Object.values(players).forEach((player) => {
    const row = document.createElement("tr");
    row.style.borderBottom = "1px solid #ddd";

    row.innerHTML = `
      <td style="text-align: center;">
        <img src="asset/images/${player.avatar}.png" alt="${
      player.name
    }" width="50" height="50" style="border-radius: 50%;">
      </td>
      <td>${player.name}</td>
      <td>${player.progress?.coinsCollected || 0}</td>
      <td>${player.progress?.timeRemaining || 0}</td>
    `;

    progressTableBody.appendChild(row);
  });

  // Append the table to the container
  progressContainer.appendChild(progressTable);
}

// Broadcast disconnection to all remaining peers
function broadcastPlayerDisconnection(playerId) {
  Object.values(dataChannels).forEach((channel) => {
    if (channel.readyState === "open") {
      channel.send(
        JSON.stringify({
          type: "player-disconnected",
          playerId,
        })
      );
    }
  });
}

// Listen for disconnection messages from peers
socket.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === "player-disconnected") {
    handlePlayerDisconnection(data.playerId);
  }
};

// Listen for disconnection messages from other peers
Object.values(dataChannels).forEach((channel) => {
  channel.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "player-disconnected") {
      handlePlayerDisconnection(message.playerId);
    }
  };
  channel.onclose = () => handlePlayerDisconnection(peerId);
});

function notifyPlayerDisconnected(peerId) {
  Object.values(dataChannels).forEach((channel) => {
    if (channel.readyState === "open") {
      channel.send(
        JSON.stringify({
          type: "player-disconnected",
          playerId: peerId,
        })
      );
    }
  });
}

function handleReconnection(playerId) {
  // Resend the latest game state to the reconnected player
  const gameState = {
    type: "game-state",
    maze: mazeGrid,
    players: Object.values(players).map(({ x, y, playerId }) => ({
      x,
      y,
      playerId,
      score: players[playerId]?.score || 0,
    })),
  };

  const channel = dataChannels[playerId];
  if (channel.readyState === "open") {
    channel.send(JSON.stringify(gameState));
  }
}

// Listen for disconnection messages from other peers
dataChannel.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.type === "player-disconnected") {
    console.log(`Player ${message.playerId} disconnected.`);
    delete players[message.playerId];
    updatePlayerList();
  }
};

// Handle disconnection of a WebRTC Data Channel
Object.values(dataChannels).forEach((channel, peerId) => {
  channel.onclose = () => handlePlayerDisconnection(peerId);
});

socket.onclose = () => {
  console.log(`WebSocket disconnected: ${localPlayerId}`);
  handlePlayerDisconnection(localPlayerId);
};

function broadcastFinalScore() {
  const finalScoreData = {
    type: "final-score",
    playerId: localPlayerId,
    name: playerName,
    score: players[localPlayerId]?.score || 0,
  };

  Object.values(dataChannels).forEach((channel, peerId) => {
    if (channel.readyState === "open") {
      channel.send(JSON.stringify(finalScoreData));
      console.log(`Broadcasted final score to peer ${peerId}:`, finalScoreData);
    } else {
      console.warn(`DataChannel to peer ${peerId} is not open.`);
    }
  });
}

// Start game timer
function startGameTimer() {
  const timerElement = document.getElementById("timer");
  if (!timerElement) {
    console.warn("Timer element not found.");
    return;
  }

  let remainingTime = gameDuration;
  gameStartTime = Date.now(); // Record start time
  timerElement.textContent = `Time Left: ${remainingTime}s`;

  const gameTimer = setInterval(() => {
    remainingTime = getTimeRemaining();
    if (remainingTime <= 0) {
      clearInterval(gameTimer);
      timerElement.textContent = `Time Left: 0s`;

      // Call endGame() when time runs out
      endGame();
      return;
    }
    timerElement.textContent = `Time Left: ${remainingTime}s`;
  }, 1000);
}

function calculateFinalScores(players, bonusPoints) {
  return players
    .map((player) => ({
      name: player.name,
      score: player.hasReachedExit
        ? player.coinsCollected + bonusPoints
        : player.coinsCollected,
    }))
    .sort((a, b) => b.score - a.score); // Sort by score descending
}

function updateScoreSpan(player) {
  const scoreSpan = document.getElementById("score");
  const currentScore = player.hasReachedExit
    ? player.coinsCollected + 50
    : player.coinsCollected;
  scoreSpan.textContent = `Score: ${currentScore}`;
}

// End the game
function endGame() {
  const finalScores = Object.values(players).map((player) => ({
    name: player.name,
    score: player.score || 0, // Ensure score is 0 if undefined
  }));

  // Broadcast final scores to all players
  socket.send(
    JSON.stringify({
      type: "final-scores",
      roomId,
      scores: finalScores,
    })
  );

  // Display the final leaderboard
  displayLeaderboard(finalScores, true);
}

// Wait for all scores to be received
function waitForAllScores() {
  return new Promise((resolve) => {
    const totalPlayers = Object.keys(players).length;
    const maxWaitTime = 5000; // Maximum wait time in milliseconds
    const startTime = Date.now();

    const checkScoresInterval = setInterval(() => {
      const playersWithScores = Object.values(players).filter(
        (player) => typeof player.score === "number"
      );

      if (
        playersWithScores.length === totalPlayers ||
        Date.now() - startTime >= maxWaitTime
      ) {
        clearInterval(checkScoresInterval);
        resolve();
      }
    }, 100); // Check every 100 milliseconds
  });
}

window.closeLeaderboard = closeLeaderboard;
