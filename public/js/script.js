let playerName = "";
let selectedAvatar = "";
let playersInRoom = [];
let countdown = 15;
let countdownInterval;

let socket = new WebSocket("ws://localhost:3000");
let roomId = new URLSearchParams(window.location.search).get("roomId");

function proceedToAvatarSelection() {
  const nameInput = document.getElementById("playerNameInput").value.trim();
  if (!nameInput) {
    alert("Please enter your name!");
    return;
  }
  playerName = nameInput;
  document.getElementById("nameModal").style.display = "none";
  document.getElementById("avatarModal").style.display = "flex";

  const avatarContainer = document.getElementById("avatarContainer");
  const avatars = [
    "hero1.png",
    "hero2.png",
    "hero3.png",
    "hero4.png",
    "hero5.png",
    "hero6.png",
  ];
  avatarContainer.innerHTML = "";
  avatars.forEach((avatar) => {
    const img = document.createElement("img");
    img.src = `/asset/images/hero/${avatar}`;
    img.alt = avatar;
    img.onclick = () => selectAvatar(avatar);
    avatarContainer.appendChild(img);
  });
}

function selectAvatar(avatar) {
  selectedAvatar = avatar;
  alert(`Avatar ${avatar} selected!`);
}

function joinWaitingRoom() {
  if (!selectedAvatar) {
    alert("Please select an avatar!");
    return;
  }

  socket.send(
    JSON.stringify({
      type: "join-room",
      roomId,
      name: playerName,
      avatar: selectedAvatar,
    })
  );

  document.getElementById("avatarModal").style.display = "none";
  document.getElementById("waitingRoomModal").style.display = "flex";
}

socket.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === "room-update" && data.roomId === roomId) {
    playersInRoom = data.players;
    updatePlayerList();

    // Start the game when the timer ends
    if (playersInRoom.length >= 2) {
      startCountdown();
    }
  }
};

function updatePlayerList() {
  const playerListContainer = document.getElementById("playerListContainer");
  playerListContainer.innerHTML = ""; // Clear previous entries
  playersInRoom.forEach((player) => {
    const div = document.createElement("div");
    div.textContent = `${player.name} (Avatar: ${player.avatar || "N/A"})`;
    playerListContainer.appendChild(div);
  });
}

function startCountdown() {
  if (countdownInterval) return; // Avoid multiple countdowns

  countdownInterval = setInterval(() => {
    document.getElementById("countdown").textContent = countdown;
    countdown--;

    if (countdown < 0) {
      clearInterval(countdownInterval);
      startGame();
    }
  }, 1000);
}

function startGame() {
  document.getElementById("waitingRoomModal").style.display = "none";
  document.getElementById("gameContainer").style.display = "block";

  // Initialize the maze game
  console.log("Game started with players:", playersInRoom);
}
