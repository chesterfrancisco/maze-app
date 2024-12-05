const socket = new WebSocket("ws://localhost:3000");

let peerConnections = {}; // Store peer connections by peer ID
let dataChannels = {}; // Store data channels by peer ID

document.getElementById("join-room").addEventListener("click", () => {
  const roomId = document.getElementById("roomIdInput").value.trim();

  if (!roomId) {
    showModal("noInputModal"); // Show invalid input modal if roomId is empty
    return;
  }

  socket.send(
    JSON.stringify({
      type: "join-room",
      roomId,
      name: "DefaultName", // Replace with actual player name input
      avatar: "hero", // Replace with actual avatar input
      playerId: Math.random().toString(36).substring(7), // Unique player ID
    })
  );

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);

    if (message.type === "error" && message.message === "Room not found.") {
      showModal("noRoomModal"); // Show "Room Not Found" modal
    } else if (message.type === "room-update") {
      console.log(`Room updated:`, message.players);
      startGame(roomId, message.players); // Proceed to game setup
    }
  };
});

/**
 * Function to start the game by redirecting to maze-game.html with the roomId
 */
function startGame(roomId, players) {
  console.log(`Starting game in Room ID: ${roomId}`);
  localStorage.setItem("roomId", roomId);
  localStorage.setItem("players", JSON.stringify(players));
  window.location.href = `maze-game.html?roomId=${roomId}`;
}

/**
 * Function to handle WebRTC signaling setup
 */
function setupSignaling(roomId, peerId) {
  if (!peerConnections[peerId]) {
    createPeerConnection(peerId, roomId, false);
  }
  console.log(`Signaling setup completed for Room ID: ${roomId}`);
}

/**
 * Function to handle signaling messages (SDP and ICE candidates)
 */
async function handleSignalingMessage(message) {
  const { peerId, sdp, candidate } = message;

  if (!peerConnections[peerId]) {
    createPeerConnection(peerId, message.roomId, false);
  }

  const peerConnection = peerConnections[peerId];

  if (sdp) {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));

    if (sdp.type === "offer") {
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.send(
        JSON.stringify({
          type: "signal",
          peerId,
          sdp: peerConnection.localDescription,
          roomId: message.roomId,
        })
      );
    }
  }

  if (candidate) {
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  }
}

/**
 * Function to create a WebRTC peer connection
 */
function createPeerConnection(peerId, roomId, isInitiator) {
  const peerConnection = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  peerConnections[peerId] = peerConnection;

  // Handle ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.send(
        JSON.stringify({
          type: "signal",
          peerId,
          candidate: event.candidate,
          roomId,
        })
      );
    }
  };

  // Handle data channel events
  peerConnection.ondatachannel = (event) => {
    const dataChannel = event.channel;
    setupDataChannel(dataChannel, peerId);
  };

  // If initiating connection, create a data channel
  if (isInitiator) {
    const dataChannel = peerConnection.createDataChannel("game");
    setupDataChannel(dataChannel, peerId);

    // Create and send SDP offer
    peerConnection
      .createOffer()
      .then((offer) => peerConnection.setLocalDescription(offer))
      .then(() => {
        socket.send(
          JSON.stringify({
            type: "signal",
            peerId,
            sdp: peerConnection.localDescription,
            roomId,
          })
        );
      });
  }
}

/**
 * Function to setup a WebRTC data channel
 */
function setupDataChannel(dataChannel, peerId) {
  dataChannels[peerId] = dataChannel;

  dataChannel.onopen = () => {
    console.log(`Data channel opened with ${peerId}`);
  };

  dataChannel.onmessage = (event) => {
    console.log(`Message from ${peerId}: ${event.data}`);
    // Handle game-related data here
  };

  dataChannel.onclose = () => {
    console.log(`Data channel closed with ${peerId}`);
    delete dataChannels[peerId];
  };
}

/**
 * Function to update the player list dynamically
 */
function updatePlayerList(players) {
  const playerListContainer = document.getElementById("playerList");
  if (playerListContainer) {
    playerListContainer.innerHTML = ""; // Clear existing list
    players.forEach((player) => {
      const playerElement = document.createElement("div");
      playerElement.textContent = `${player.name} (Avatar: ${player.avatar})`;
      playerListContainer.appendChild(playerElement);
    });
  }
}

/**
 * Function to remove a disconnected peer
 */
function removePeer(peerId) {
  console.log(`Removing peer ${peerId}`);
  delete peerConnections[peerId];
  delete dataChannels[peerId];
}

/**
 * Function to show a modal
 */
function showModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = "flex";
  }
}

/**
 * Function to close a modal
 */
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = "none";
  }
}

// Expose closeModal globally for inline use
window.closeModal = closeModal;
