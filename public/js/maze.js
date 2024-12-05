export function generateMaze(width, height, seed) {
  const maze = Array.from({ length: height }, () => Array(width).fill(1));

  // Simple random generator using seed for consistent mazes
  const rng = seedRandom(seed);

  // Generate maze paths
  const startX = Math.floor(rng() * width);
  const startY = Math.floor(rng() * height);
  carvePath(maze, startX, startY, rng); // Ensure carvePath is defined

  // Place an exit
  let exitX, exitY;
  do {
    exitX = Math.floor(rng() * width);
    exitY = Math.floor(rng() * height);
  } while (maze[exitY][exitX] !== 0);
  maze[exitY][exitX] = 0;

  // Generate coins
  const coins = generateCoins(maze, width, height, rng);

  return {
    maze,
    exit: { x: exitX, y: exitY },
    coins,
  };
}

// Carve paths in the maze
export function carvePath(maze, x, y, rng) {
  const directions = shuffleDirections(rng);
  maze[y][x] = 0;

  for (const [dx, dy] of directions) {
    const nx = x + dx * 2;
    const ny = y + dy * 2;

    if (
      ny > 0 &&
      ny < maze.length &&
      nx > 0 &&
      nx < maze[0].length &&
      maze[ny][nx] === 1
    ) {
      maze[y + dy][x + dx] = 0;
      carvePath(maze, nx, ny, rng);
    }
  }
}

// Generate coins in the maze
export function generateCoins(maze, width, height, rng) {
  const coins = [];
  const coinCount = Math.max(5, Math.floor((width * height) / 10)); // Place ~10% of the cells with coins

  while (coins.length < coinCount) {
    const x = Math.floor(rng() * width);
    const y = Math.floor(rng() * height);

    // Only place coins in walkable cells
    if (
      maze[y][x] === 0 && // Ensure the cell is walkable (white)
      !coins.some((coin) => coin.x === x && coin.y === y) // Avoid duplicates
    ) {
      coins.push({ x, y });
    }
  }
  return coins;
}

// Helper function to shuffle directions
export function shuffleDirections(rng) {
  const directions = [
    [0, -1], // Up
    [0, 1], // Down
    [-1, 0], // Left
    [1, 0], // Right
  ];
  for (let i = directions.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [directions[i], directions[j]] = [directions[j], directions[i]];
  }
  return directions;
}

// Simple pseudo-random number generator based on seed
export function seedRandom(seed) {
  let value = seed;
  return function () {
    value = Math.sin(value) * 10000;
    return value - Math.floor(value);
  };
}
