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
        title: 'title.png',
        box: 'box.png'
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
    const API_SERVER_URL = 'https://game.qwpo.cc:8080';

    // --- Game Objects & State ---
    let localBird, remoteBird, score, startTime, remoteScore;
    let obstacles = [];
    let itemBoxes = [];
    let particles = [];
    let sizeEffect = { active: false, multiplier: 1, duration: 0, startTime: 0 };
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
        connection: { x: 140, y: 390, w: 200, h: 50, text: 'Go Online' }
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
        updateItemBoxes(deltaTime);
        updateParticles(deltaTime);

        if (['playing_single', 'playing_multi'].includes(gameState)) {
            updatePlayer(deltaTime);
        }

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
            case GAME_STATES.GAME_OVER: 
                drawObstacles();
                drawItemBoxes();
                if (remoteBird) drawBird(remoteBird, 0.5);
                if (localBird) drawBird(localBird, 1.0);
                if (gameState !== GAME_STATES.GAME_OVER) drawPlayingUI();
                break;
        }
        drawParticles();
        drawLobbyStatus();
    }

    // --- Drawing Functions ---
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
        ctx.fillText('Menu', canvas.width / 2, 150);

        const buttonColor = '#A7D9B7';
        const buttonAlpha = 0.5;
        const borderRadius = 15;

        // Dynamically update connection button text
        const isOnline = peer && !peer.disconnected;
        menuButtons.connection.text = isOnline ? 'Go Offline' : 'Go Online';
        menuButtons.multi.disabled = !isOnline; // Disable multiplay if offline

        Object.values(menuButtons).forEach(button => {
            const alpha = button.disabled ? 0.2 : buttonAlpha;
            const color = button.disabled ? '#888' : buttonColor;
            drawRoundedRect(ctx, button.x, button.y, button.w, button.h, borderRadius, color, alpha);
            ctx.fillStyle = 'white';
            ctx.font = '16px "Press Start 2P"';
            ctx.fillText(button.text, button.x + button.w / 2, button.y + button.h / 2 + 8);
        });
    }

    function drawLobby() {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
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

        ctx.font = '33px "Press Start 2P"';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'white';
        ctx.fillText(score.toFixed(1), canvas.width / 2, 65);

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

    function drawItemBoxes() {
        itemBoxes.forEach(box => {
            ctx.drawImage(images.box, box.x, box.y, box.width, box.height);
        });
    }

    function drawParticles() {
        particles.forEach(p => {
            ctx.globalAlpha = p.life / p.initialLife;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1.0;
        });
    }

    function spawnParticles(x, y, color) {
        const count = 30;
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            const speed = 2 + Math.random() * 4;
            particles.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: 2 + Math.random() * 3,
                color: color,
                initialLife: 40 + Math.random() * 30,
                life: 40 + Math.random() * 30
            });
        }
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
        const birdSizeMultiplier = (bird === localBird && sizeEffect.active) ? sizeEffect.multiplier : 1;
        const birdCurrentWidth = bird.width * birdSizeMultiplier;
        const birdCurrentHeight = bird.height * birdSizeMultiplier;

        const drawX = bird.x + (bird.width - birdCurrentWidth) / 2;
        const drawY = bird.y + (bird.height - birdCurrentHeight) / 2;

        ctx.drawImage(images.bird, drawX, drawY, birdCurrentWidth, birdCurrentHeight);
        ctx.globalAlpha = 1.0;
    }

    // --- Updates ---
    function updateBackground(deltaTime) {
        const overlap = 3;
        background.x1 -= background.speed * deltaTime;
        background.x2 -= background.speed * deltaTime;
        if (background.x1 <= -canvas.width) background.x1 = background.x2 + canvas.width - overlap;
        if (background.x2 <= -canvas.width) background.x2 = background.x1 + canvas.width - overlap;
    }

    function updateItemBoxes(deltaTime) {
        itemBoxes.forEach(box => {
            box.x -= obstacleSpeed * deltaTime;
            box.angle += 0.05 * deltaTime;
            box.y = box.initialY + Math.sin(box.angle) * 5;
        });
        itemBoxes = itemBoxes.filter(box => box.x + box.width > 0);
    }

    function updateParticles(deltaTime) {
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx * deltaTime;
            p.y += p.vy * deltaTime;
            p.vy += 0.05 * deltaTime;
            p.life -= deltaTime;
            if (p.life <= 0) {
                particles.splice(i, 1);
            }
        }
    }

    function updateObstacles(deltaTime) {
        if (isHost) {
            timeToNextObstacle -= deltaTime;
            if (timeToNextObstacle <= 0) {
                const allNewObs = [];
                let currentX = canvas.width;
                const horizontalSpacing = 250 + Math.random() * 250;
                const verticalGap = 190;
                let topH;

                if (lastPipe) {
                    const lastHoleCenter = lastPipe.topH + (lastPipe.verticalGap / 2);
                    const maxVerticalChangeRatio = 0.6;
                    const maxChange = (horizontalSpacing / 500) * (canvas.height * maxVerticalChangeRatio);
                    const minChange = 40;
                    const allowedChange = Math.max(maxChange, minChange);
                    const newHoleCenter_min = Math.max(lastHoleCenter - allowedChange, 100);
                    const newHoleCenter_max = Math.min(lastHoleCenter + allowedChange, canvas.height - 100);
                    const newHoleCenter = Math.random() * (newHoleCenter_max - newHoleCenter_min) + newHoleCenter_min;
                    topH = newHoleCenter - (verticalGap / 2);
                } else {
                    const verticalMargin = canvas.height * 0.25;
                    topH = Math.random() * (canvas.height - verticalGap - (2 * verticalMargin)) + verticalMargin;
                }

                topH = Math.max(60, Math.min(topH, canvas.height - verticalGap - 60));
                const oWidth = 80 + Math.random() * 80;
                const newPair = [
                    { x: currentX, y: 0, width: oWidth, height: topH },
                    { x: currentX, y: topH + verticalGap, width: oWidth, height: canvas.height - topH - verticalGap }
                ];
                allNewObs.push(...newPair);

                if (Math.random() < 0.1) {
                    const boxSize = 40;
                    const itemBox = {
                        id: Date.now() + Math.random(),
                        x: currentX + oWidth / 2 - boxSize / 2,
                        y: topH + verticalGap / 2 - boxSize / 2,
                        width: boxSize,
                        height: boxSize,
                        initialY: topH + verticalGap / 2 - boxSize / 2,
                        angle: Math.random() * Math.PI * 2
                    };
                    itemBoxes.push(itemBox);
                    if (gameConn && gameConn.open) {
                        gameConn.send({ type: 'ITEM_SPAWNED', payload: itemBox });
                    }
                }

                lastPipe = { topH: topH, verticalGap: verticalGap };
                obstacles.push(...allNewObs);
                if (gameConn && gameConn.open) {
                    gameConn.send({ type: 'OBSTACLES', payload: allNewObs });
                }
                timeToNextObstacle = horizontalSpacing / obstacleSpeed;
            }
        }
        obstacles.forEach(obs => obs.x -= obstacleSpeed * deltaTime);
        obstacles = obstacles.filter(obs => obs.x + obs.width > 0);
    }

    function updatePlayer(deltaTime) {
        if (sizeEffect.active && Date.now() - sizeEffect.startTime > sizeEffect.duration) {
            sizeEffect.active = false;
        }

        localBird.velocityY += gravity * deltaTime;
        localBird.y += localBird.velocityY * deltaTime;
        score = (Date.now() - startTime) / 1000;
        if (gameConn && gameConn.open) {
            gameConn.send({ type: 'BIRD_POS', payload: { y: localBird.y, score: score } });
        }
        checkCollisions();
        checkItemCollisions();
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
            if (button.disabled) continue;

            if (x >= button.x && x <= button.x + button.w && y >= button.y && y <= button.y + button.h) {
                switch (key) {
                    case 'single':
                        changeState(GAME_STATES.COUNTDOWN, { isSinglePlayer: true });
                        break;
                    case 'multi':
                        changeState(GAME_STATES.LOBBY);
                        break;
                    case 'connection':
                        const isOnline = peer && !peer.disconnected;
                        if (isOnline) {
                            shutdownNetworking();
                        } else {
                            connectToLobbyServer();
                        }
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
        const oldState = gameState;

        // --- State Exit Cleanup ---
        // If we are leaving a state that could have a P2P connection, clean it up.
        if ([GAME_STATES.PLAYING_MULTI, GAME_STATES.GAME_OVER, GAME_STATES.COUNTDOWN].includes(oldState)) {
            if (gameConn) {
                gameConn.close();
                gameConn = null;
                console.log('P2P connection closed.');
            }
        }

        // --- State Enter Setup ---
        lobbyUi.style.display = 'none';
        gameOverOverlay.style.display = 'none';

        gameState = newState;
        console.log('Game state changed to:', newState);

        if (newState === GAME_STATES.MENU) {
            // When entering menu, automatically try to connect if not already connected.
            // The lobby socket was closed when the game started, so it should be closed now.
            if (!lobbySocket || (lobbySocket.readyState !== WebSocket.OPEN && lobbySocket.readyState !== WebSocket.CONNECTING)) {
                connectToLobbyServer();
            }
        }
        if (newState === GAME_STATES.LOBBY) {
            lobbyUi.style.display = 'block';
            // Nickname UI is part of the lobby screen
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
        localBird = { x: 100, y: 250, width: 45, height: 45, velocityY: 0 };
        obstacles = []; 
        score = 0;  
        timeToNextObstacle = 0;
        lastPipe = null;
        itemBoxes = [];
        particles = [];
        sizeEffect = { active: false, multiplier: 1, duration: 0, startTime: 0 };
        
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
        const birdSizeMultiplier = sizeEffect.active ? sizeEffect.multiplier : 1;
        const baseCollisionBox = { x: 5, y: 8, width: 34, height: 24 }; 
        const scaledWidth = baseCollisionBox.width * birdSizeMultiplier;
        const scaledHeight = baseCollisionBox.height * birdSizeMultiplier;

        const birdBox = { 
            x: localBird.x + (localBird.width / 2) - (scaledWidth / 2),
            y: localBird.y + (localBird.height / 2) - (scaledHeight / 2),
            width: scaledWidth,
            height: scaledHeight
        };

        if (birdBox.y + birdBox.height > canvas.height || birdBox.y < 0) endGame();
        for (const obs of obstacles) {
            if (birdBox.x < obs.x + obs.width && birdBox.x + birdBox.width > obs.x && birdBox.y < obs.y + obs.height && birdBox.y + birdBox.height > obs.y) endGame();
        }
    }

    function checkItemCollisions() {
        const birdSizeMultiplier = sizeEffect.active ? sizeEffect.multiplier : 1;
        const baseCollisionBox = { x: 5, y: 8, width: 34, height: 24 };
        const scaledWidth = baseCollisionBox.width * birdSizeMultiplier;
        const scaledHeight = baseCollisionBox.height * birdSizeMultiplier;
        const birdBox = { 
            x: localBird.x + (localBird.width / 2) - (scaledWidth / 2),
            y: localBird.y + (localBird.height / 2) - (scaledHeight / 2),
            width: scaledWidth,
            height: scaledHeight
        };

        for (let i = itemBoxes.length - 1; i >= 0; i--) {
            const box = itemBoxes[i];
            if (birdBox.x < box.x + box.width && birdBox.x + birdBox.width > box.x && birdBox.y < box.y + box.height && birdBox.y + birdBox.height > box.y) {
                sizeEffect.active = true;
                sizeEffect.multiplier = Math.random() < 0.5 ? 1.5 : 0.5;
                sizeEffect.duration = 5000; // 5 seconds
                sizeEffect.startTime = Date.now();

                spawnParticles(box.x + box.width / 2, box.y + box.height / 2, sizeEffect.multiplier > 1 ? '#FFD700' : '#8A2BE2');

                if (gameConn && gameConn.open) {
                    gameConn.send({ type: 'ITEM_COLLECTED', payload: { id: box.id } });
                }

                itemBoxes.splice(i, 1); // Remove the box
            }
        }
    }
    
    function jump() {
        if (['playing_single', 'playing_multi'].includes(gameState)) {
            localBird.velocityY = -jumpStrength;
        }
    }

    // --- Networking ---
    const MANUAL_CLOSE_CODE = 4000;

    function shutdownNetworking() {
        if (lobbySocket) {
            lobbySocket.close(MANUAL_CLOSE_CODE, "User disconnected");
        }
        if (peer) {
            peer.destroy();
        }
        peer = null;
        lobbySocket = null;
        lobbyStatus = { status: 'disconnected', message: 'Lobby: Disconnected' };
        lobbyPeers = [];
        console.log('Network systems shut down.');
    }

    function updateNicknameAndReconnect() {
        const newNick = nicknameInput.value.trim();
        if (!newNick || newNick === myNickname) {
            nicknameInput.value = '';
            return;
        }
        myNickname = newNick;
        localStorage.setItem('stupid-bird-nickname', myNickname);
        shutdownNetworking();
        connectToLobbyServer();
    }

    async function initializePeerSystem(token) {
        if (peer) peer.destroy();

        let turnConfig;
        try {
            const response = await fetch(`${API_SERVER_URL}/api/turn-credentials?token=${token}`);
            if (!response.ok) {
                throw new Error(`API request failed with status ${response.status}`);
            }
            turnConfig = await response.json();
        } catch (error) {
            console.error('Could not fetch TURN credentials:', error);
            lobbyStatus = { status: 'error', message: 'Lobby: Auth Failed' };
            return;
        }

        myNickname = localStorage.getItem('stupid-bird-nickname') || 'Player';
        const randomPart = Math.random().toString(36).substr(2, 6);
        myPeerId = `${myNickname.replace(/\s+/g, '_')}-${randomPart}`;
        
        if (myIdDisplay) myIdDisplay.textContent = myPeerId;
        
        peer = new Peer(myPeerId, { config: turnConfig });

        peer.on('open', () => {
            lobbyStatus = { status: 'connected', message: 'Lobby: Connected' };
            lobbySocket.send(JSON.stringify({ type: 'ANNOUNCE', id: myPeerId }));
        });

        peer.on('connection', (newConn) => {
            if (gameConn) { 
                newConn.on('open', () => newConn.close());
                return;
            }
            isHost = true;
            setupGameConnection(newConn);
        });

        peer.on('error', err => {
            console.error("PeerJS Global Error:", err);
            lobbyStatus = { status: 'error', message: `P2P System Error: ${err.type}` };
            if (gameConn) gameConn.close();
        });

        peer.on('disconnected', () => {
            lobbyStatus = { status: 'disconnected', message: 'Lobby: Disconnected' };
        });
    }

    function connectToLobbyServer() {
        if (lobbySocket && lobbySocket.readyState === WebSocket.OPEN) return;

        lobbyStatus = { status: 'connecting', message: 'Lobby: Connecting...' };
        lobbySocket = new WebSocket(LOBBY_SERVER_URL);

        lobbySocket.onopen = () => {
            // Wait for server to send token
        };

        lobbySocket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'CREDENTIAL_TOKEN') {
                    initializePeerSystem(data.payload.token);
                }
                if (data.type === 'PEER_LIST') {
                    lobbyPeers = data.list;
                    updateLobbyUI();
                }
            } catch (e) { console.error('Error parsing message:', e); }
        };

        lobbySocket.onclose = (event) => {
            // Any close, manual or not, means we are disconnected from the lobby.
            lobbyStatus = { status: 'disconnected', message: 'Lobby: Disconnected' };
            console.log(`Lobby WebSocket closed: code ${event.code}`);
        };

        lobbySocket.onerror = (err) => {
            lobbyStatus = { status: 'error', message: 'Lobby: Error' };
        };
    }

    function setupGameConnection(newConn) {
        if (gameConn) gameConn.close();
        gameConn = newConn;

        gameConn.on('error', (err) => {
            console.error('P2P Connection Error:', err);
            lobbyStatus = { status: 'error', message: `Connection Failed: ${err.type}` };
        });
        
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
                case 'ITEM_SPAWNED':
                    itemBoxes.push(data.payload);
                    break;
                case 'ITEM_COLLECTED':
                    itemBoxes = itemBoxes.filter(box => box.id !== data.payload.id);
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
                    if (newGameButton.disabled) {
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
                newGameButton.disabled = true;
            } 
            else if (gameState !== GAME_STATES.MENU) { 
                alert('Opponent disconnected.'); 
                changeState(GAME_STATES.MENU);
            }
            
            gameConn = null; 
            updateLobbyUI();
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