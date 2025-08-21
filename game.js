document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const getEl = id => document.getElementById(id);
    const canvas = getEl('game-canvas');
    const ctx = canvas.getContext('2d');
    const scoreEl = getEl('score');
    const opponentScoreEl = getEl('opponent-score');
    const finalScoreEl = getEl('final-score');
    const gameOverContainer = getEl('game-over-container');
    const gameOverTitle = getEl('game-over-title');
    const uiContainer = getEl('ui-container');
    const myPeerIdEl = getEl('my-peer-id');
    const peerIdInput = getEl('peer-id-input');
    const connectButton = getEl('connect-button');
    const connectionStatusEl = getEl('connection-status');
    const userListEl = getEl('user-list');
    const newGameButton = getEl('new-game-button');
    const startGameButton = getEl('start-game-button');

    // --- Game State & Constants ---
    let localBird, remoteBird, obstacles, background, score;
    let gameState = 'loading'; // loading, single_player, multiplayer_lobby, multiplayer_playing, over
    let peer, gameConn, lobbyConn, myPeerId, isHost = false;
    let localPlayerReady = false, remotePlayerReady = false;
    let lastTime = 0, timeToNextObstacle = 0;
    const LOBBY_ID = 'stupid-bird-lobby-999';
    const gravity = 0.4, jumpStrength = 8, obstacleSpeed = 3;
    const birdCollisionBox = { x: 5, y: 8, width: 34, height: 24 };

    // --- Image Loading ---
    const imageSources = { bird: 'bird.png', bg: 'bg.png', longPlumbing: 'long_plumbing.png' };
    const images = {};
    const loadImages = (cb) => {
        let loaded = 0, num = Object.keys(imageSources).length;
        for (const key in imageSources) {
            images[key] = new Image();
            images[key].src = imageSources[key];
            images[key].onload = () => { if (++loaded === num) cb(); };
        }
    };

    // --- Core Game Loop ---
    function gameLoop(currentTime) {
        if (!lastTime) lastTime = currentTime;
        const deltaTime = (currentTime - lastTime) / (1000 / 60);
        lastTime = currentTime;
        if (['single_player', 'multiplayer_playing'].includes(gameState)) {
            update(deltaTime);
            draw();
        }
        requestAnimationFrame(gameLoop);
    }

    // --- Update & Draw ---
    function update(deltaTime) {
        localBird.velocityY += gravity * deltaTime;
        localBird.y += localBird.velocityY * deltaTime;

        const overlap = 3;
        background.x1 -= background.speed * deltaTime;
        background.x2 -= background.speed * deltaTime;
        if (background.x1 <= -canvas.width) background.x1 = background.x2 + canvas.width - overlap;
        if (background.x2 <= -canvas.width) background.x2 = background.x1 + canvas.width - overlap;

        if (isHost) {
            timeToNextObstacle -= deltaTime;
            if (timeToNextObstacle <= 0) {
                const oWidth = 80 + Math.random() * 50, gap = 220, topH = Math.random() * (canvas.height - gap - 150) + 75;
                const newObs = [
                    { x: canvas.width, y: 0, width: oWidth, height: topH },
                    { x: canvas.width, y: topH + gap, width: oWidth, height: canvas.height - topH - gap }
                ];
                obstacles.push(...newObs);
                if (gameConn) gameConn.send({ type: 'OBSTACLES', payload: newObs });
                timeToNextObstacle = 120;
            }
            obstacles.forEach(obs => obs.x -= obstacleSpeed * deltaTime);
            obstacles = obstacles.filter(obs => obs.x + obs.width > 0);
        }

        if (gameConn) {
            gameConn.send({ type: 'BIRD_POS', payload: { y: localBird.y } });
            gameConn.send({ type: 'SCORE', payload: { score: score } });
        }

        checkCollisions();
        score = parseFloat(((Date.now() - startTime) / 1000).toFixed(2));
    }

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(images.bg, background.x1, 0, canvas.width, canvas.height);
        ctx.drawImage(images.bg, background.x2, 0, canvas.width, canvas.height);
        obstacles.forEach(obs => ctx.drawImage(images.longPlumbing, obs.x, obs.y, obs.width, obs.height));
        if (remoteBird) {
            ctx.globalAlpha = 0.5;
            ctx.drawImage(images.bird, remoteBird.x, remoteBird.y, remoteBird.width, remoteBird.height);
            ctx.globalAlpha = 1.0;
        }
        ctx.drawImage(images.bird, localBird.x, localBird.y, localBird.width, localBird.height);
        scoreEl.textContent = score;
    }

    // --- Game State ---
    function resetGame(mode) {
        localPlayerReady = false;
        remotePlayerReady = false;
        gameState = mode;
        isHost = (mode === 'single_player' || isHost);
        localBird = { x: 100, y: 250, width: 45, height: 45, velocityY: 0 };
        remoteBird = (mode === 'multiplayer_playing') ? { x: 100, y: 250, width: 45, height: 45 } : null;
        uiContainer.classList.toggle('multiplayer-mode', mode === 'multiplayer_playing');
        background = { x1: 0, x2: canvas.width, speed: 2 };
        obstacles = [];
        score = 0;
        startTime = Date.now();
        timeToNextObstacle = 0;
        lastTime = performance.now();
        gameOverContainer.classList.remove('visible');
        uiContainer.style.display = 'block';
    }

    function endGame(winner = false) {
        if (gameState === 'over') return;
        gameState = 'over';
        if (gameConn) gameConn.send({ type: 'GAME_OVER' });
        gameOverTitle.textContent = winner ? "You Win!" : "Game Over";
        gameOverContainer.classList.add('visible');
    }

    function checkCollisions() {
        const birdBox = { x: localBird.x + birdCollisionBox.x, y: localBird.y + birdCollisionBox.y, width: birdCollisionBox.width, height: birdCollisionBox.height };
        if (birdBox.y + birdBox.height > canvas.height || birdBox.y < 0) endGame();
        for (const obs of obstacles) {
            if (birdBox.x < obs.x + obs.width && birdBox.x + birdBox.width > obs.x && birdBox.y < obs.y + obs.height && birdBox.y + birdBox.height > obs.y) endGame();
        }
    }
    
    function jump() {
        if (['single_player', 'multiplayer_playing'].includes(gameState)) {
            localBird.velocityY = -jumpStrength;
        }
    }

    // --- P2P Networking ---
    function initializePeerSystem() {
        myPeerId = localStorage.getItem('stupid-bird-peer-id') || `bird-${Math.random().toString(36).substr(2, 6)}`;
        localStorage.setItem('stupid-bird-peer-id', myPeerId);
        myPeerIdEl.textContent = myPeerId;
        peer = new Peer(myPeerId, { config: { 'iceServers': [{ urls: 'stun:stun.l.google.com:19302' }] } });

        peer.on('open', () => {
            connectionStatusEl.textContent = "Lobby connected. Waiting for players...";
            // Simplified lobby: just be ready for connections.
        });
        peer.on('connection', setupGameConnection);
        peer.on('error', err => { console.error("PeerJS Error:", err); connectionStatusEl.textContent = err.type; });
    }

    function setupGameConnection(newConn) {
        if (gameConn) gameConn.close();
        gameConn = newConn;
        isHost = true; // The one who receives the connection is the host
        connectionStatusEl.textContent = `Connected with ${gameConn.peer}. Click Start.`;
        startGameButton.style.display = 'block';
        
        gameConn.on('open', () => {}); // Connection is already open

        gameConn.on('data', data => {
            switch (data.type) {
                case 'BIRD_POS': if(remoteBird) remoteBird.y = data.payload.y; break;
                case 'OBSTACLES': obstacles.push(...data.payload); break;
                case 'SCORE': opponentScoreEl.textContent = data.payload.score.toFixed(2); break;
                case 'GAME_OVER': endGame(true); break;
                case 'READY': 
                    remotePlayerReady = true; 
                    connectionStatusEl.textContent = `Opponent is ready!`;
                    checkIfBothReady(); 
                    break;
            }
        });
        gameConn.on('close', () => {
            alert('Opponent disconnected.');
            resetGame('single_player');
            gameConn = null;
            startGameButton.style.display = 'none';
        });
    }

    function playerReady() {
        if (!gameConn) return;
        localPlayerReady = true;
        gameConn.send({ type: 'READY' });
        connectionStatusEl.textContent = 'Ready! Waiting for opponent...';
        checkIfBothReady();
    }

    function checkIfBothReady() {
        if (localPlayerReady && remotePlayerReady) {
            resetGame('multiplayer_playing');
        }
    }

    // --- Initial Load & Event Listeners ---
    loadImages(() => {
        initializePeerSystem();
        resetGame('single_player');
        requestAnimationFrame(gameLoop);
    });

    connectButton.addEventListener('click', () => {
        const remoteId = peerIdInput.value.trim();
        if (remoteId && remoteId !== myPeerId) {
            isHost = false; // The one who initiates is the client
            setupGameConnection(peer.connect(remoteId));
        }
    });

    startGameButton.addEventListener('click', playerReady);
    newGameButton.addEventListener('click', () => {
        if (gameConn) {
            playerReady();
        } else {
            resetGame('single_player');
        }
    });

    window.addEventListener('keydown', e => { if (e.code === 'Space') jump(); });
    canvas.addEventListener('click', jump);
});