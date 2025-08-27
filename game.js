document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');
    // Lobby UI
    const lobbyUi = document.getElementById('lobby-ui');
    const myIdDisplay = document.getElementById('my-id-display');
    const nicknameInput = document.getElementById('nickname-input');
    const saveNicknameButton = document.getElementById('save-nickname-button');
    // Game Over UI
    const gameOverOverlay = document.getElementById('game-over-overlay');
    const gameOverTitleElement = document.getElementById('game-over-title');
    const myFinalScoreTextElement = document.getElementById('my-final-score-text');
    const opponentFinalScoreTextElement = document.getElementById('opponent-final-score-text');
    const newGameButton = document.getElementById('new-game-button');
    const backToMenuButtonGameOver = document.getElementById('back-to-menu-button');

    // --- Image Loading ---
    const images = {};
    const imageSources = { 
        bird: 'bird.png', 
        bg: 'bg.png', 
        longPlumbing: 'long_plumbing.png',
        title: 'title.png'
    };

    function loadImages(callback) {
        let loaded = 0;
        const numImages = Object.keys(imageSources).length;
        for (const key in imageSources) {
            images[key] = new Image();
            images[key].src = imageSources[key];
            images[key].onload = () => { if (++loaded >= numImages) callback(); };
        }
    }

    // --- Game States & Constants ---
    const GAME_STATES = {
        INTRO: 'intro',
        MENU: 'menu',
        LOBBY: 'lobby',
        COUNTDOWN: 'countdown',
        PLAYING_SINGLE: 'playing_single',
        PLAYING_MULTI: 'playing_multi',
        GAME_OVER: 'game_over'
    };
    let gameState = GAME_STATES.INTRO;
    let lobbyStatus = { status: 'disconnected', message: 'Lobby: Disconnected' };
    let peer, gameConn, myPeerId, myNickname, isHost = false, lobbyPeers = [];
    let lobbySocket;
    const LOBBY_SERVER_URL = 'wss://game.qwpo.cc:8080';

    // --- Game Objects & State ---
    let localBird, remoteBird, score, startTime, remoteScore;
    let obstacles = [];
    let lastPipe = null;
    let background = { x1: 0, x2: canvas.width, speed: 2 };
    let localPlayerReady = false, remotePlayerReady = false, remoteFinalScore = null, remotePlayerFinished = false;
    let lastTime = 0, timeToNextObstacle = 0;
    let countdownTimer = 4;

    const gravity = 0.4, jumpStrength = 8, obstacleSpeed = 3;
    const birdCollisionBox = { x: 5, y: 8, width: 34, height: 24 };

    // --- UI Definitions ---
    const menuButtons = {
        single: { x: 140, y: 250, w: 200, h: 50, text: 'Single Play' },
        multi: { x: 140, y: 320, w: 200, h: 50, text: 'Multi Play' },
        settings: { x: 140, y: 390, w: 200, h: 50, text: 'Settings' }
    };
    const lobbyBackButton = { x: 20, y: canvas.height - 60, w: 200, h: 40, text: 'Back to Menu' };
    let lobbyButtons = [];
    const quitButton = { x: canvas.width - 110, y: 10, w: 100, h: 30, text: 'Quit' };

    // --- Main Game Loop ---
    let lastLoopTime = 0;
    function gameLoop(currentTime) {
        if (!lastLoopTime) lastLoopTime = currentTime;
        const deltaTime = (currentTime - lastLoopTime) / (1000 / 60);
        lastLoopTime = currentTime;

        update(deltaTime);
        draw();
        requestAnimationFrame(gameLoop);
    }

    // --- Central Update & Draw ---
    function update(deltaTime) {
        updateBackground(deltaTime);

        // Player is only updated when they are actively playing.
        if (['playing_single', 'playing_multi'].includes(gameState)) {
            updatePlayer(deltaTime);
        }

        // Obstacles should only be updated when the game is actually in a playing state
        // for single player, or a state where obstacles matter in multiplayer.
        if (gameState === 'playing_single') {
            updateObstacles(deltaTime);
        } else if (gameConn && (gameState === 'playing_multi' || gameState === 'game_over')) {
            updateObstacles(deltaTime);
        }
    }

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawBackground();

        switch (gameState) {
            case GAME_STATES.INTRO:
                drawIntro();
                break;
            case GAME_STATES.MENU:
                drawMenu();
                break;
            case GAME_STATES.LOBBY:
                drawLobby();
                break;
            case GAME_STATES.COUNTDOWN:
                drawCountdown();
                break;
            case GAME_STATES.PLAYING_SINGLE:
            case GAME_STATES.PLAYING_MULTI:
            case GAME_STATES.GAME_OVER: // Keep drawing the game scene behind the popup
                drawObstacles();
                if (remoteBird) drawBird(remoteBird, 0.5);
                if (localBird) drawBird(localBird, 1.0);
                if (gameState !== GAME_STATES.GAME_OVER) drawPlayingUI();
                break;
        }
        drawLobbyStatus();
    }

    // --- State-Specific Drawing ---
    function drawIntro() {
        if (images.title) {
            const img = images.title;
            const canvasWidth = canvas.width;
            const scale = Math.min(1, (canvasWidth * 0.9) / img.width);
            const w = img.width * scale;
            const h = img.height * scale;
            const x = canvasWidth / 2 - w / 2;
            const y = 100;
            ctx.drawImage(img, x, y, w, h);
        }
        ctx.fillStyle = 'white';
        ctx.font = '16px "Press Start 2P"';
        ctx.textAlign = 'center';
        ctx.fillText('Click to Start', canvas.width / 2, 450);
    }

    function drawRoundedRect(ctx, x, y, width, height, radius, color, alpha = 1) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    function drawMenu() {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'white';
        ctx.font = '40px "Press Start 2P"';
        ctx.textAlign = 'center';
        ctx.fillText('Main Menu', canvas.width / 2, 150);

        const buttonColor = '#A7D9B7';
        const buttonAlpha = 0.5;
        const borderRadius = 15;

        Object.values(menuButtons).forEach(button => {
            drawRoundedRect(ctx, button.x, button.y, button.w, button.h, borderRadius, buttonColor, buttonAlpha);
            ctx.fillStyle = 'white';
            ctx.font = '16px "Press Start 2P"';
            ctx.fillText(button.text, button.x + button.w / 2, button.y + button.h / 2 + 8);
        });
    }

    function drawLobby() {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Draw title with new font and shadow
        ctx.save();
        ctx.font = '30px "Press Start 2P"';
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;
        ctx.shadowBlur = 3;
        ctx.fillStyle = 'white';
        ctx.fillText('Lobby', canvas.width / 2, 80);
        ctx.restore();

        lobbyButtons.forEach(button => {
            drawRoundedRect(ctx, button.x, button.y, button.w, button.h, 10, 'rgba(0,0,0,0.5)');
            ctx.fillStyle = 'white';
            ctx.font = '12px "Press Start 2P"';
            ctx.textAlign = 'left';
            ctx.fillText(button.peerId, button.x + 15, button.y + button.h / 2 + 7);
            
            const connectButton = button.connectButton;
            drawRoundedRect(ctx, connectButton.x, button.y, connectButton.w, button.h, 8, connectButton.disabled ? '#7f8c8d' : '#2ecc71');
            ctx.fillStyle = 'white';
            ctx.font = '12px "Press Start 2P"';
            ctx.textAlign = 'center';
            ctx.fillText(connectButton.text, connectButton.x + connectButton.w / 2, button.y + button.h / 2 + 6);
        });

        // Draw the back button
        const btn = lobbyBackButton;
        drawRoundedRect(ctx, btn.x, btn.y, btn.w, btn.h, 15, '#e74c3c', 0.7);
        ctx.fillStyle = 'white';
        ctx.font = '14px "Press Start 2P"';
        ctx.textAlign = 'center';
        ctx.fillText(btn.text, btn.x + btn.w / 2, btn.y + btn.h / 2 + 7);
    }

    function drawCountdown() {
        const anim = (Date.now() % 1000) / 1000;
        const alpha = Math.sin(anim * Math.PI);
        const scale = 1 + (1 - alpha) * 1.5;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = 'white';
        ctx.font = `${80 * scale}px "Press Start 2P"`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const text = countdownTimer > 0 ? countdownTimer : 'Start!';
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);
        ctx.restore();
    }

    function drawPlayingUI() {
        drawRoundedRect(ctx, quitButton.x, quitButton.y, quitButton.w, quitButton.h, 10, '#e74c3c');
        ctx.fillStyle = 'white';
        ctx.font = '12px "Press Start 2P"';
        ctx.textAlign = 'center';
        ctx.fillText(quitButton.text, quitButton.x + quitButton.w / 2, quitButton.y + quitButton.h / 2 + 6);

        // My Score
        ctx.font = '33px "Press Start 2P"';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'white';
        ctx.fillText(score.toFixed(1), canvas.width / 2, 65);

        // Opponent's Score
        if (gameState === GAME_STATES.PLAYING_MULTI && remoteScore) {
            ctx.font = '20px "Press Start 2P"';
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.fillText(remoteScore.toFixed(1), canvas.width / 2, 95);
        }
    }

    function drawLobbyStatus() {
        let color = '#e74c3c';
        if (lobbyStatus.status === 'connected') color = '#2ecc71';
        if (lobbyStatus.status === 'connecting') color = '#f1c40f';

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(20, 20, 8, 0, 2 * Math.PI);
        ctx.fill();

        ctx.fillStyle = 'white';
        ctx.font = '10px "Press Start 2P"';
        ctx.textAlign = 'left';
        ctx.fillText(lobbyStatus.message, 35, 25);
    }

    function drawBackground() {
        ctx.drawImage(images.bg, background.x1, 0, canvas.width, canvas.height);
        ctx.drawImage(images.bg, background.x2, 0, canvas.width, canvas.height);
    }

    function drawObstacles() {
        obstacles.forEach(obs => {
            if (obs.y === 0) { // Top obstacle
                ctx.save();
                ctx.translate(obs.x + obs.width / 2, obs.y + obs.height / 2);
                ctx.rotate(Math.PI);
                ctx.drawImage(images.longPlumbing, -obs.width / 2, -obs.height / 2, obs.width, obs.height);
                ctx.restore();
            } else { // Bottom obstacle
                ctx.drawImage(images.longPlumbing, obs.x, obs.y, obs.width, obs.height);
            }
        });
    }

    function drawBird(bird, alpha) {
        ctx.globalAlpha = alpha;
        ctx.drawImage(images.bird, bird.x, bird.y, bird.width, bird.height);
        ctx.globalAlpha = 1.0;
    }

    // --- State-Specific Updates ---
    function updateBackground(deltaTime) {
        const overlap = 3;
        background.x1 -= background.speed * deltaTime;
        background.x2 -= background.speed * deltaTime;
        if (background.x1 <= -canvas.width) background.x1 = background.x2 + canvas.width - overlap;
        if (background.x2 <= -canvas.width) background.x2 = background.x1 + canvas.width - overlap;
    }

    function updateObstacles(deltaTime) {
        if (isHost) {
            timeToNextObstacle -= deltaTime;
            if (timeToNextObstacle <= 0) {
                const allNewObs = [];
                let currentX = canvas.width;

                // Determine horizontal distance for this new pipe. This is the key for the new logic.
                const horizontalSpacing = 250 + Math.random() * 250; // Range from 250px to 500px

                const verticalGap = 190; // A fixed, comfortable gap size (Increased by 10px)
                let topH;

                if (lastPipe) {
                    const lastHoleCenter = lastPipe.topH + (lastPipe.verticalGap / 2);
                    
                    // Wider horizontal spacing allows for greater vertical change.
                    // A small spacing (e.g., 250px) allows for a small change.
                    // A large spacing (e.g., 500px) allows for a large change.
                    const maxVerticalChangeRatio = 0.6; // How much of the screen height can it change at max spacing
                    const maxChange = (horizontalSpacing / 500) * (canvas.height * maxVerticalChangeRatio);
                    const minChange = 40; // Always allow at least a small change
                    const allowedChange = Math.max(maxChange, minChange);

                    // Calculate the bounds for the new hole's center
                    const newHoleCenter_min = Math.max(lastHoleCenter - allowedChange, 100);
                    const newHoleCenter_max = Math.min(lastHoleCenter + allowedChange, canvas.height - 100);
                    
                    const newHoleCenter = Math.random() * (newHoleCenter_max - newHoleCenter_min) + newHoleCenter_min;
                    topH = newHoleCenter - (verticalGap / 2);
                } else {
                    // First pipe, generate freely in the middle area.
                    const verticalMargin = canvas.height * 0.25;
                    topH = Math.random() * (canvas.height - verticalGap - (2 * verticalMargin)) + verticalMargin;
                }

                // Clamp topH to ensure it's not impossible
                topH = Math.max(60, Math.min(topH, canvas.height - verticalGap - 60));

                const oWidth = 80 + Math.random() * 80; // Width is now random, from 80 to 160
                const newPair = [
                    { x: currentX, y: 0, width: oWidth, height: topH },
                    { x: currentX, y: topH + verticalGap, width: oWidth, height: canvas.height - topH - verticalGap }
                ];
                
                allNewObs.push(...newPair);

                // Store this pipe's properties for the next one.
                lastPipe = { topH: topH, verticalGap: verticalGap };
                
                obstacles.push(...allNewObs);
                if (gameConn && gameConn.open) {
                    gameConn.send({ type: 'OBSTACLES', payload: allNewObs });
                }

                // Set timer for the next obstacle based on the horizontal spacing
                timeToNextObstacle = horizontalSpacing / obstacleSpeed;
            }
        }
        obstacles.forEach(obs => obs.x -= obstacleSpeed * deltaTime);
        obstacles = obstacles.filter(obs => obs.x + obs.width > 0);
    }

    function updatePlayer(deltaTime) {
        localBird.velocityY += gravity * deltaTime;
        localBird.y += localBird.velocityY * deltaTime;
        score = (Date.now() - startTime) / 1000;
        if (gameConn && gameConn.open) {
            gameConn.send({ type: 'BIRD_POS', payload: { y: localBird.y, score: score } });
        }
        checkCollisions();
    }

    // --- Input Handling ---
    function handleClick(event) {
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        switch (gameState) {
            case GAME_STATES.INTRO:
                changeState(GAME_STATES.MENU);
                break;
            case GAME_STATES.MENU:
                handleMenuClick(x, y);
                break;
            case GAME_STATES.LOBBY:
                handleLobbyClick(x, y);
                break;
            case GAME_STATES.PLAYING_SINGLE:
            case GAME_STATES.PLAYING_MULTI:
                handlePlayingClick(x, y);
                break;
        }
    }

    function handleMenuClick(x, y) {
        for (const key in menuButtons) {
            const button = menuButtons[key];
            if (x >= button.x && x <= button.x + button.w && y >= button.y && y <= button.y + button.h) {
                switch (key) {
                    case 'single':
                        changeState(GAME_STATES.COUNTDOWN, { isSinglePlayer: true });
                        break;
                    case 'multi':
                        changeState(GAME_STATES.LOBBY);
                        break;
                    case 'settings':
                        // alert('Settings not implemented yet.');
                        break;
                }
                return;
            }
        }
    }

    function handleLobbyClick(x, y) {
        const backBtn = lobbyBackButton;
        if (x >= backBtn.x && x <= backBtn.x + backBtn.w && y >= backBtn.y && y <= backBtn.y + backBtn.h) {
            changeState(GAME_STATES.MENU);
            return;
        }

        lobbyButtons.forEach(button => {
            const cb = button.connectButton;
            if (!cb.disabled && x >= cb.x && x <= cb.x + cb.w && y >= button.y && y <= button.y + button.h) {
                if (gameConn) return;
                isHost = false;
                setupGameConnection(peer.connect(button.peerId, { reliable: true }));
                lobbyButtons.forEach(b => b.connectButton.disabled = true);
            }
        });
    }

    function handlePlayingClick(x, y) {
        if (x >= quitButton.x && x <= quitButton.x + quitButton.w && y >= quitButton.y && y <= quitButton.y + quitButton.h) {
            endGame();
        } else {
            jump();
        }
    }

    // --- State Management & Game Logic ---
    let countdownInterval;
    function changeState(newState, options = {}) {
        lobbyUi.style.display = 'none';
        gameOverOverlay.style.display = 'none';

        gameState = newState;
        console.log('Game state changed to:', newState);

        if (newState === GAME_STATES.MENU) {
            if (gameConn) {
                gameConn.close();
                gameConn = null;
            }
            if (!peer || peer.disconnected) {
                initializePeerSystem();
            } else if (!lobbySocket || lobbySocket.readyState !== WebSocket.OPEN) {
                connectToLobbyServer();
            }
        }
        if (newState === GAME_STATES.LOBBY) {
            lobbyUi.style.display = 'block';
            if(myPeerId) myIdDisplay.textContent = myPeerId;
            nicknameInput.value = '';
            nicknameInput.placeholder = myNickname;
        }
        if (newState === GAME_STATES.COUNTDOWN) {
            if (options.isSinglePlayer) {
                isHost = true;
            }
            resetGame(options.isSinglePlayer ? 'single_player' : 'multiplayer');
            countdownTimer = 3;
            if(countdownInterval) clearInterval(countdownInterval);
            countdownInterval = setInterval(() => {
                countdownTimer--;
                if (countdownTimer < 0) {
                    clearInterval(countdownInterval);
                    changeState(gameConn ? GAME_STATES.PLAYING_MULTI : GAME_STATES.PLAYING_SINGLE);
                }
            }, 1000);
        }

        if (newState === GAME_STATES.PLAYING_SINGLE || newState === GAME_STATES.PLAYING_MULTI) {
            startTime = Date.now();
        }
    }

    function resetGame(mode) {
        // isHost is now set in changeState or on connection
        localBird = { x: 100, y: 250, width: 45, height: 45, velocityY: 0 };
        obstacles = []; 
        score = 0;  
        timeToNextObstacle = 0;
        lastPipe = null;
        
        localPlayerReady = false;
        remotePlayerReady = false;

        if (mode === 'multiplayer') {
            remoteBird = { x: 100, y: 250, width: 45, height: 45 };
            remotePlayerFinished = false; 
            remoteFinalScore = null;
            remoteScore = 0;
        } else {
            remoteBird = null;
        }
    }

    function endGame() {
        if (gameState === GAME_STATES.GAME_OVER) return;
        gameState = GAME_STATES.GAME_OVER;

        if (gameConn && gameConn.open) {
            gameConn.send({ type: 'GAME_OVER', payload: { score: score } });
        }

        updateGameOverUI();
        gameOverOverlay.style.display = 'flex';
    }

    function updateGameOverUI() {
        myFinalScoreTextElement.textContent = `My Time: ${score.toFixed(2)}s`;

        if (gameConn) { // Multiplayer Game Over
            opponentFinalScoreTextElement.style.display = 'block';
            if (remotePlayerFinished) {
                const winner = score > remoteFinalScore;
                gameOverTitleElement.textContent = winner ? "You Win!" : "You Lose!";
                opponentFinalScoreTextElement.textContent = `Opponent: ${remoteFinalScore.toFixed(2)}s`;
            } else {
                gameOverTitleElement.textContent = "Finished!";
                opponentFinalScoreTextElement.textContent = "Opponent is still playing...";
            }
        } else { // Single Player Game Over
            gameOverTitleElement.textContent = "Game Over";
            myFinalScoreTextElement.textContent = `Time: ${score.toFixed(2)}s`;
            opponentFinalScoreTextElement.style.display = 'none';
        }
        
        newGameButton.disabled = false;
        newGameButton.textContent = 'New Game';
    }

    function checkCollisions() {
        const birdBox = { x: localBird.x + birdCollisionBox.x, y: localBird.y + birdCollisionBox.y, width: birdCollisionBox.width, height: birdCollisionBox.height };
        if (birdBox.y + birdBox.height > canvas.height || birdBox.y < 0) endGame();
        for (const obs of obstacles) {
            if (birdBox.x < obs.x + obs.width && birdBox.x + birdBox.width > obs.x && birdBox.y < obs.y + obs.height && birdBox.y + birdBox.height > obs.y) endGame();
        }
    }
    
    function jump() {
        if (['playing_single', 'playing_multi'].includes(gameState)) {
            localBird.velocityY = -jumpStrength;
        }
    }

    // --- Networking ---
    const MANUAL_CLOSE_CODE = 4000;

    function updateNicknameAndReconnect() {
        const newNick = nicknameInput.value.trim();
        if (!newNick || newNick === myNickname) {
            nicknameInput.value = '';
            return;
        }

        myNickname = newNick;
        localStorage.setItem('stupid-bird-nickname', myNickname);
        
        if (lobbySocket) lobbySocket.close(MANUAL_CLOSE_CODE, 'Changing nickname');
        if (peer) peer.destroy();

        initializePeerSystem();
    }

    function initializePeerSystem() {
        myNickname = localStorage.getItem('stupid-bird-nickname') || 'Player';
        const randomPart = Math.random().toString(36).substr(2, 6);
        myPeerId = `${myNickname.replace(/\s+/g, '_')}-${randomPart}`;
        
        if (myIdDisplay) myIdDisplay.textContent = myPeerId;
        
        const peerJsConfig = { config: { 'iceServers': [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'turn:game.qwpo.cc:3478', username: 'testuser', credential: 'testpass' }] } };

        peer = new Peer(myPeerId, peerJsConfig);
        peer.on('open', () => {
            connectToLobbyServer();
        });
        peer.on('connection', (newConn) => {
            if (gameConn) { 
                newConn.on('open', () => newConn.close());
                return;
            }
            isHost = true;
            setupGameConnection(newConn);
        });
        peer.on('error', err => { console.error("PeerJS Error:", err); lobbyStatus = { status: 'error', message: 'P2P Error' }; });
    }

    function connectToLobbyServer() {
        lobbyStatus = { status: 'connecting', message: 'Lobby: Connecting...' };
        if (lobbySocket && lobbySocket.readyState < 2) lobbySocket.close();
        lobbySocket = new WebSocket(LOBBY_SERVER_URL);

        lobbySocket.onopen = () => {
            lobbyStatus = { status: 'connected', message: 'Lobby: Connected' };
            lobbySocket.send(JSON.stringify({ type: 'ANNOUNCE', id: myPeerId }));
        };

        lobbySocket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'PEER_LIST') {
                    lobbyPeers = data.list;
                    updateLobbyUI();
                }
            } catch (e) { console.error('Error parsing message:', e); }
        };

        lobbySocket.onclose = (event) => {
            // Do not auto-reconnect if the close was intentional
            if (event.code === MANUAL_CLOSE_CODE) {
                lobbyStatus = { status: 'disconnected', message: 'Lobby: Disconnected' };
                return;
            }
            if (gameState === GAME_STATES.MENU || gameState === GAME_STATES.LOBBY) {
                 setTimeout(connectToLobbyServer, 3000);
            }
            lobbyStatus = { status: 'disconnected', message: 'Lobby: Disconnected' };
        };

        lobbySocket.onerror = (err) => {
            lobbyStatus = { status: 'error', message: 'Lobby: Error' };
        };
    }

    function setupGameConnection(newConn) {
        if (gameConn) gameConn.close();
        gameConn = newConn;
        
        gameConn.once('open', () => {
            if (lobbySocket) lobbySocket.close(MANUAL_CLOSE_CODE, 'Starting game');
            changeState(GAME_STATES.COUNTDOWN);
        });

        gameConn.on('data', data => {
            switch (data.type) {
                case 'BIRD_POS': 
                    if(remoteBird) remoteBird.y = data.payload.y; 
                    if(data.payload.score) remoteScore = data.payload.score;
                    break;
                case 'OBSTACLES': 
                    obstacles.push(...data.payload); 
                    break;
                case 'GAME_OVER': 
                    remotePlayerFinished = true;
                    remoteFinalScore = data.payload.score;
                    if (remoteBird) remoteBird = null;
                    if (gameState === GAME_STATES.GAME_OVER) {
                        updateGameOverUI();
                    }
                    break;
                case 'READY_FOR_NEW_GAME':
                    remotePlayerReady = true;
                    if (newGameButton.disabled) { // We are waiting
                        newGameButton.textContent = "Opponent is Ready!";
                    }
                    if (localPlayerReady) {
                        changeState(GAME_STATES.COUNTDOWN);
                    }
                    break;
            }
        });

        gameConn.on('close', () => { 
            if (gameState === GAME_STATES.GAME_OVER) {
                opponentFinalScoreTextElement.textContent = "Opponent has disconnected.";
                newGameButton.disabled = true; // Can't start a new game
            } else if (gameState !== GAME_STATES.MENU) { // Avoid alert if we already went to menu
                alert('Opponent disconnected.'); 
                changeState(GAME_STATES.MENU);
            }
            gameConn = null; 
        });
    }

    function updateLobbyUI() {
        lobbyButtons = [];
        let yPos = 250;
        lobbyPeers.forEach(id => {
            if (id === myPeerId) return;

            const isConnectedToThisPeer = gameConn && gameConn.open && gameConn.peer === id;
            const button = {
                peerId: id,
                x: 40, y: yPos, w: 400, h: 40,
                connectButton: {
                    x: 300, w: 120, 
                    text: isConnectedToThisPeer ? 'Connected' : 'Connect',
                    disabled: !!gameConn
                }
            };
            lobbyButtons.push(button);
            yPos += 50;
        });
    }

    // --- Event Listeners ---
    function handleNewGameClick() {
        if (!gameConn) { // Single player
            changeState(GAME_STATES.COUNTDOWN, { isSinglePlayer: true });
        } else { // Multiplayer
            localPlayerReady = true;
            newGameButton.disabled = true;
            newGameButton.textContent = 'Wait...';
            gameConn.send({ type: 'READY_FOR_NEW_GAME' });
            if (remotePlayerReady) {
                changeState(GAME_STATES.COUNTDOWN);
            }
        }
    }

    // --- Initial Load & Event Listeners ---
    // Remove the initial explicit hide, as it's now handled by inline styles
    canvas.addEventListener('click', handleClick);
    canvas.addEventListener('touchstart', (e) => { e.preventDefault(); handleClick(e.touches[0]); }, { passive: false });
    
    saveNicknameButton.addEventListener('click', updateNicknameAndReconnect);
    newGameButton.addEventListener('click', handleNewGameClick);
    backToMenuButtonGameOver.addEventListener('click', () => changeState(GAME_STATES.MENU));

    loadImages(() => {
        lastLoopTime = performance.now();
        requestAnimationFrame(gameLoop);
    });
});