const socket = new WebSocket("ws://localhost:3000");

const peerConnections = {}; // Track peer connections by peer ID
const dataChannels = {}; // Track data channels by peer ID

document.getElementById("create-room").addEventListener("click", () => {
  const roomId = Math.random().toString(36).substring(2, 7);
  document.getElementById("room-info").textContent = `Room ID: ${roomId}`;

  const startGameLink = document.getElementById("start-game");
  startGameLink.href = `maze-game.html?roomId=${roomId}`;
  startGameLink.style.display = "block";

  // Send room creation to the server
  socket.send(JSON.stringify({ type: "create-room", roomId }));

  // *** Add WebRTC Setup for Signaling ***
  setupSignaling(roomId);
});

/**
 * Function to handle WebRTC signaling setup
 */
function setupSignaling(roomId) {
  // Listen for signaling messages from the server
  socket.onmessage = async (event) => {
    const message = JSON.parse(event.data);

    if (message.type === "signal") {
      await handleSignalingMessage(message);
    } else if (message.type === "peer-joined") {
      console.log(`New peer joined: ${message.peerId}`);
      createPeerConnection(message.peerId, roomId, true); // Create connection and initiate offer
    }
  };

  console.log(`Signaling setup completed for Room ID: ${roomId}`);
}

/**
 * Function to handle signaling messages
 * (like SDP and ICE candidates)
 */
async function handleSignalingMessage(message) {
  const { peerId, sdp, candidate } = message;

  // Ensure the peer connection exists
  if (!peerConnections[peerId]) {
    createPeerConnection(peerId, message.roomId, false);
  }

  const peerConnection = peerConnections[peerId];

  if (sdp) {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));

    // If the SDP type is 'offer', create and send an answer
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
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }], // Use a public STUN server
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

  // Create data channel if this is the initiator
  if (isInitiator) {
    const dataChannel = peerConnection.createDataChannel("game");
    setupDataChannel(dataChannel, peerId);

    // Create and send an SDP offer
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
 * Function to setup a data channel
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
  };
}
