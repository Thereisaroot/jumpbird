document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');

    // UI Elements
    const scoreEl = document.getElementById('score');
    const finalScoreEl = document.getElementById('final-score');
    const gameOverContainer = document.getElementById('game-over-container');
    const highScoresEl = document.getElementById('high-scores');
    const newGameButton = document.getElementById('new-game-button');
    const uiContainer = document.getElementById('ui-container');
    const gameContainer = document.getElementById('game-container');

    // Debug UI
    const debugContainer = document.getElementById('debug-container');
    const jumpStrengthEl = document.getElementById('jump-strength');
    const gravityStrengthEl = document.getElementById('gravity-strength');
    const increaseJumpBtn = document.getElementById('increase-jump');
    const decreaseJumpBtn = document.getElementById('decrease-jump');
    const increaseGravityBtn = document.getElementById('increase-gravity');
    const decreaseGravityBtn = document.getElementById('decrease-gravity');
    const toggleDebugBtn = document.getElementById('toggle-debug');

    // Game variables
    let bird, obstacles, background, score, startTime, highScores;
    let gravity = 0.4;
    let jumpStrength = 8;
    let obstacleSpeed = 3;
    let gameState = 'title'; // title, playing, over
    let debugMode = false;
    let lastTime = 0;
    let timeToNextObstacle = 0;

    const imageSources = {
        bird: 'bird.png',
        bg: 'bg.png',
        longPlumbing: 'long_plumbing.png',
        title: 'title.png'
    };
    const images = {};

    const birdCollisionBox = { x: 5, y: 8, width: 34, height: 24 };

    function loadImages(callback) {
        let loaded = 0;
        const numImages = Object.keys(imageSources).length;
        for (const key in imageSources) {
            images[key] = new Image();
            images[key].src = imageSources[key];
            images[key].onload = () => {
                loaded++;
                if (loaded === numImages) callback();
            };
            images[key].onerror = () => console.error(`Failed to load image: ${imageSources[key]}`);
        }
    }

    function resetGame() {
        bird = { x: 100, y: 250, width: 45, height: 45, velocityY: 0 };
        background = { x1: 0, x2: canvas.width, speed: 2 };
        obstacles = [];
        score = 0;
        startTime = Date.now();
        gameState = 'playing';
        timeToNextObstacle = 0;
        lastTime = performance.now();
        gameOverContainer.classList.remove('visible');
        uiContainer.style.display = 'block';
    }

    function gameLoop(currentTime) {
        if (!lastTime) lastTime = currentTime;
        const deltaTime = (currentTime - lastTime) / (1000 / 60);
        lastTime = currentTime;

        if (gameState === 'playing') {
            update(deltaTime);
            draw();
        } else if (gameState === 'title') {
            drawTitleScreen();
        }
        requestAnimationFrame(gameLoop);
    }

    function update(deltaTime) {
        const overlap = 3;
        background.x1 -= background.speed * deltaTime;
        background.x2 -= background.speed * deltaTime;
        if (background.x1 <= -canvas.width) background.x1 = background.x2 + canvas.width - overlap;
        if (background.x2 <= -canvas.width) background.x2 = background.x1 + canvas.width - overlap;

        bird.velocityY += gravity * deltaTime;
        bird.y += bird.velocityY * deltaTime;

        const birdBox = getBirdCollisionBox();
        if (birdBox.y + birdBox.height > canvas.height || birdBox.y < 0) {
            endGame();
            return;
        }

        score = ((Date.now() - startTime) / 1000).toFixed(2);

        timeToNextObstacle -= deltaTime;
        if (timeToNextObstacle <= 0) {
            const obstacleWidth = 80 + Math.random() * 50;
            const gapHeight = 220;
            const topPipeHeight = Math.random() * (canvas.height - gapHeight - 150) + 75;
            obstacles.push({ x: canvas.width, y: 0, width: obstacleWidth, height: topPipeHeight, type: 'longPlumbing' });
            obstacles.push({ x: canvas.width, y: topPipeHeight + gapHeight, width: obstacleWidth, height: canvas.height - topPipeHeight - gapHeight, type: 'longPlumbing' });
            timeToNextObstacle = 120;
        }

        obstacles.forEach(obs => { obs.x -= obstacleSpeed * deltaTime; });
        obstacles = obstacles.filter(obs => obs.x + obs.width > 0);

        checkCollisions();
    }

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(images.bg, background.x1, 0, canvas.width, canvas.height);
        ctx.drawImage(images.bg, background.x2, 0, canvas.width, canvas.height);
        obstacles.forEach(obs => ctx.drawImage(images[obs.type], obs.x, obs.y, obs.width, obs.height));
        ctx.drawImage(images.bird, bird.x, bird.y, bird.width, bird.height);
        if (debugMode) drawDebug();
        scoreEl.textContent = score;
    }

    function drawTitleScreen() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(images.bg, 0, 0, canvas.width, canvas.height);
        const titleImg = images.title;
        const imgAspectRatio = titleImg.height / titleImg.width;
        const targetWidth = canvas.width * 0.9;
        const targetHeight = targetWidth * imgAspectRatio;
        const x = (canvas.width - targetWidth) / 2;
        const y = (canvas.height - targetHeight) / 2 - 50;
        ctx.drawImage(titleImg, x, y, targetWidth, targetHeight);
        ctx.fillStyle = 'white';
        ctx.font = '24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Click or Press Space to Start', canvas.width / 2, y + targetHeight + 40);
    }

    function drawDebug() {
        ctx.fillStyle = 'rgba(255, 105, 180, 0.7)';
        const debugPadding = 3;
        const birdBox = getBirdCollisionBox();
        ctx.fillRect(birdBox.x - debugPadding, birdBox.y - debugPadding, birdBox.width + (debugPadding * 2), birdBox.height + (debugPadding * 2));
        obstacles.forEach(obs => {
            ctx.fillRect(obs.x - debugPadding, obs.y - debugPadding, obs.width + (debugPadding * 2), obs.height + (debugPadding * 2));
        });
    }

    function getBirdCollisionBox() {
        return { x: bird.x + birdCollisionBox.x, y: bird.y + birdCollisionBox.y, width: birdCollisionBox.width, height: birdCollisionBox.height };
    }

    function checkCollisions() {
        const birdBox = getBirdCollisionBox();
        for (const obs of obstacles) {
            if (birdBox.x < obs.x + obs.width && birdBox.x + birdBox.width > obs.x && birdBox.y < obs.y + obs.height && birdBox.y + birdBox.height > obs.y) {
                endGame();
                return;
            }
        }
    }

    function startGame() {
        if (gameState === 'title') resetGame();
    }

    function jump() {
        if (gameState === 'playing') bird.velocityY = -jumpStrength;
    }

    function endGame() {
        if (gameState === 'over') return;
        gameState = 'over';
        updateHighScores(parseFloat(score));
        finalScoreEl.textContent = score;
        gameOverContainer.classList.add('visible');
        uiContainer.style.display = 'none';
    }

    function updateHighScores(newScore) {
        highScores = JSON.parse(localStorage.getItem('flappyBirdHighScores')) || [];
        highScores.push(newScore);
        highScores.sort((a, b) => b - a);
        highScores = highScores.slice(0, 5);
        localStorage.setItem('flappyBirdHighScores', JSON.stringify(highScores));
        displayHighScores();
    }

    function displayHighScores() {
        highScoresEl.innerHTML = '';
        highScores = JSON.parse(localStorage.getItem('flappyBirdHighScores')) || [];
        highScores.forEach(s => {
            const li = document.createElement('li');
            li.textContent = `${s.toFixed(2)}s`;
            highScoresEl.appendChild(li);
        });
    }

    // --- Secret Debug Activation ---
    let secretClickCount = 0;
    let secretClickTimer = null;
    let keySequence = '';

    function showDebugMenu() {
        if (debugContainer.style.display !== 'block') {
            debugContainer.style.display = 'block';
            console.log('Debug menu activated.');
        }
    }

    document.body.addEventListener('click', (e) => {
        if (!gameContainer.contains(e.target)) {
            secretClickCount++;
            clearTimeout(secretClickTimer);
            secretClickTimer = setTimeout(() => { secretClickCount = 0; }, 1500);
            if (secretClickCount >= 5) {
                showDebugMenu();
                secretClickCount = 0;
            }
        }
    });

    // --- Event Listeners ---
    window.addEventListener('keydown', (e) => {
        keySequence += e.key;
        keySequence = keySequence.slice(-2);
        if (keySequence === 'dd') {
            showDebugMenu();
        }

        if (e.code === 'Space') {
            if (gameState === 'title') startGame();
            else if (gameState === 'playing') jump();
        }
    });

    canvas.addEventListener('click', () => {
        if (gameState === 'title') startGame();
        else if (gameState === 'playing') jump();
    });

    newGameButton.addEventListener('click', () => {
        gameOverContainer.classList.remove('visible');
        resetGame();
    });

    // Debug controls
    increaseJumpBtn.addEventListener('click', () => { jumpStrength = parseFloat((jumpStrength + 0.5).toFixed(1)); jumpStrengthEl.textContent = jumpStrength; });
    decreaseJumpBtn.addEventListener('click', () => { jumpStrength = parseFloat(Math.max(1, jumpStrength - 0.5).toFixed(1)); jumpStrengthEl.textContent = jumpStrength; });
    increaseGravityBtn.addEventListener('click', () => { gravity = parseFloat((gravity + 0.1).toFixed(1)); gravityStrengthEl.textContent = gravity; });
    decreaseGravityBtn.addEventListener('click', () => { gravity = parseFloat(Math.max(0.1, gravity - 0.1).toFixed(1)); gravityStrengthEl.textContent = gravity; });
    toggleDebugBtn.addEventListener('click', () => { debugMode = !debugMode; });

    function init() {
        uiContainer.style.display = 'none';
        displayHighScores();
        requestAnimationFrame(gameLoop);
    }

    loadImages(init);
});
