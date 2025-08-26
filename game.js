document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const getEl = id => document.getElementById(id);
    const canvas = getEl('game-canvas');
    const ctx = canvas.getContext('2d');
    const scoreEl = getEl('score');
    const opponentScoreEl = getEl('opponent-score');
    const finalScoreEl = getEl('final-score');
    const myFinalScoreEl = getEl('my-final-score');
    const opponentFinalScoreEl = getEl('opponent-final-score');
    const gameOverContainer = getEl('game-over-container');
    const gameOverTitle = getEl('game-over-title');
    const uiContainer = getEl('ui-container');
    const myPeerIdEl = getEl('my-peer-id');
    const peerIdInput = getEl('peer-id-input');
    const connectButton = getEl('connect-button');
    const connectionStatusEl = getEl('connection-status');
    const userListEl = getEl('user-list');
    const newGameButton = getEl('new-game-button');
    const nicknameInput = getEl('nickname-input');
    const saveNicknameButton = getEl('save-nickname-button');

    // --- Game State & Constants ---
    let localBird, remoteBird, obstacles, background, score;
    let gameState = 'loading';
    let peer, gameConn, myPeerId, myNickname, isHost = false, isLobbyHost = false, lobbyPeer, lobbyPeers = [];
    let localPlayerReady = false, remotePlayerReady = false, remoteFinalScore = null, remotePlayerFinished = false;
    let lastTime = 0, timeToNextObstacle = 0;
    const LOBBY_ID = 'stupid-bird-flock-lobby-v3-final';
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
                const newObs = [{ x: canvas.width, y: 0, width: oWidth, height: topH }, { x: canvas.width, y: topH + gap, width: oWidth, height: canvas.height - topH - gap }];
                obstacles.push(...newObs);
                if (gameConn && gameConn.open) {
                    gameConn.send({ type: 'OBSTACLES', payload: newObs });
                }
                timeToNextObstacle = 120;
            }
        }

        obstacles.forEach(obs => obs.x -= obstacleSpeed * deltaTime);
        obstacles = obstacles.filter(obs => obs.x + obs.width > 0);

        score = parseFloat(((Date.now() - startTime) / 1000).toFixed(2));
        if (gameConn && gameConn.open && gameState === 'multiplayer_playing') {
            gameConn.send({ type: 'BIRD_POS', payload: { y: localBird.y } });
        }
        checkCollisions();
    }

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(images.bg, background.x1, 0, canvas.width, canvas.height);
        ctx.drawImage(images.bg, background.x2, 0, canvas.width, canvas.height);

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

        if (remoteBird) {
            ctx.globalAlpha = 0.5;
            ctx.drawImage(images.bird, remoteBird.x, remoteBird.y, remoteBird.width, remoteBird.height);
            ctx.globalAlpha = 1.0;
        }
        ctx.drawImage(images.bird, localBird.x, localBird.y, localBird.width, localBird.height);
        scoreEl.textContent = score;
    }

    // --- Game State & UI ---
    function resetGame(mode) {
        localPlayerReady = false; remotePlayerReady = false; remoteFinalScore = null; remotePlayerFinished = false;
        gameState = mode;
        if (mode === 'single_player') {
            isHost = true;
        }
        localBird = { x: 100, y: 250, width: 45, height: 45, velocityY: 0 };
        remoteBird = (mode === 'multiplayer_playing') ? { x: 100, y: 250, width: 45, height: 45 } : null;
        uiContainer.classList.toggle('multiplayer-mode', mode === 'multiplayer_playing');
        background = { x1: 0, x2: canvas.width, speed: 2 };
        obstacles = []; score = 0; startTime = Date.now(); timeToNextObstacle = 0; lastTime = performance.now();
        gameOverContainer.classList.remove('visible');
        uiContainer.style.display = 'block';
    }

    function endGame() {
        if (gameState === 'over') return;
        gameState = 'over';
        newGameButton.disabled = false; newGameButton.textContent = 'New Game';
        if (gameConn && gameConn.open) {
            gameConn.send({ type: 'GAME_OVER', payload: { score: score } });
            gameOverContainer.classList.add('multiplayer-results-mode');
            myFinalScoreEl.textContent = `${score}s`;
            if (remotePlayerFinished) {
                const winner = score > remoteFinalScore;
                gameOverTitle.textContent = winner ? "You Win!" : "You Lose!";
                opponentFinalScoreEl.textContent = `${remoteFinalScore}s`;
            } else {
                gameOverTitle.textContent = "Finished!";
                opponentFinalScoreEl.textContent = "Opponent is playing...";
            }
        } else {
            gameOverContainer.classList.remove('multiplayer-results-mode');
            finalScoreEl.textContent = score;
            gameOverTitle.textContent = "Game Over";
        }
        gameOverContainer.classList.add('visible');
    }

    function checkCollisions() {
        const birdBox = { x: localBird.x + birdCollisionBox.x, y: localBird.y + birdCollisionBox.y, width: birdCollisionBox.width, height: birdCollisionBox.height };
        if (birdBox.y + birdBox.height > canvas.height || birdBox.y < 0) endGame();
        for (const obs of obstacles) {
            if (birdBox.x < obs.x + obs.width && birdBox.x + birdBox.width > obs.x && birdBox.y < obs.y + obs.height && birdBox.y + birdBox.height > obs.y) endGame();
        }
    }
    
    function jump() { if (['single_player', 'multiplayer_playing'].includes(gameState)) localBird.velocityY = -jumpStrength; }

    // --- P2P Networking ---
    function initializePeerSystem() {
        myNickname = localStorage.getItem('stupid-bird-nickname') || 'Player';
        nicknameInput.value = myNickname;
        
        const randomPart = Math.random().toString(36).substr(2, 6);
        myPeerId = `${myNickname.replace(/\s+/g, '_')}-${randomPart}`;
        
        myPeerIdEl.textContent = myPeerId;

        const peerJsConfig = {
            config: {
                'iceServers': [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'turn:91.99.226.49:3478', username: 'testuser', credential: 'testpass' }
                ]
            }
        };

        peer = new Peer(myPeerId, peerJsConfig);
        peer.on('open', () => { initializeLobbyPeer(); });
        peer.on('connection', (newConn) => {
            isHost = true;
            setupGameConnection(newConn);
        });
        peer.on('error', err => { console.error("PeerJS Error:", err); });
    }

    saveNicknameButton.addEventListener('click', () => {
        const newNickname = nicknameInput.value.trim();
        if (newNickname) {
            localStorage.setItem('stupid-bird-nickname', newNickname);
            alert('Nickname saved! Please refresh the page for the change to take full effect.');
        } else {
            alert('Nickname cannot be empty.');
        }
    });

    function initializeLobbyPeer() {
        lobbyPeer = new Peer(LOBBY_ID);

        lobbyPeer.on('open', () => {
            isLobbyHost = true;
            lobbyPeers = [myPeerId];
            connectionStatusEl.textContent = "Lobby: You are the host.";
            updateUserList(lobbyPeers);
            lobbyPeer.on('connection', (conn) => {
                conn.on('data', (data) => {
                    if (data.type === 'ANNOUNCE') {
                        if (!lobbyPeers.includes(data.id)) {
                            lobbyPeers.push(data.id);
                        }
                        updateUserList(lobbyPeers);
                        broadcastPeerList(lobbyPeer, lobbyPeers);
                    }
                });
                conn.on('close', () => {
                    // Only remove peer if we are not in an active game with them
                    if (!gameConn || gameConn.peer !== conn.peer) {
                        lobbyPeers = lobbyPeers.filter(p => p !== conn.peer);
                        updateUserList(lobbyPeers);
                        broadcastPeerList(lobbyPeer, lobbyPeers);
                    }
                });
            });
        });

        lobbyPeer.on('error', () => {
            lobbyPeer.destroy();
            const lobbyConn = peer.connect(LOBBY_ID, { reliable: true });
            connectionStatusEl.textContent = "Lobby: Connecting...";
            lobbyConn.on('open', () => {
                connectionStatusEl.textContent = "Lobby: Connected.";
                lobbyConn.send({ type: 'ANNOUNCE', id: myPeerId });
            });
            lobbyConn.on('data', (data) => {
                if (data.type === 'PEER_LIST') {
                    lobbyPeers = data.list; // Client updates its own list
                    updateUserList(lobbyPeers);
                }
            });
            lobbyConn.on('close', () => { connectionStatusEl.textContent = "Lobby disconnected."; userListEl.innerHTML = ''; });
        });
    }

    function broadcastPeerList(lobbyPeer, lobbyPeers) {
        Object.values(lobbyPeer.connections).flat().forEach(conn => {
            conn.send({ type: 'PEER_LIST', list: lobbyPeers });
        });
    }

    function setupGameConnection(newConn) {
        if (gameConn) {
            gameConn.close();
        }
        gameConn = newConn;
        
        gameConn.once('open', () => {
            connectionStatusEl.textContent = `Connected to ${gameConn.peer}!`;
            if (isLobbyHost) {
                broadcastPeerList(lobbyPeer, lobbyPeers);
            }
            updateUserList(lobbyPeers);
        });

        gameOverTitle.textContent = "Ready to Play?";
        gameOverContainer.classList.add('multiplayer-results-mode');
        myFinalScoreEl.textContent = "-"; opponentFinalScoreEl.textContent = "-";
        gameOverContainer.classList.add('visible');
        uiContainer.style.display = 'none';

        gameConn.on('data', data => {
            switch (data.type) {
                case 'BIRD_POS': if(remoteBird) remoteBird.y = data.payload.y; break;
                case 'OBSTACLES': obstacles.push(...data.payload); break;
                case 'GAME_OVER': 
                    remotePlayerFinished = true;
                    remoteFinalScore = data.payload.score;
                    remoteBird = null;
                    opponentScoreEl.textContent = `Finished: ${remoteFinalScore}`;
                    if (gameState === 'over') {
                        const localScore = parseFloat(myFinalScoreEl.textContent);
                        const winner = localScore > remoteFinalScore;
                        gameOverTitle.textContent = winner ? "You Win!" : "You Lose!";
                        opponentFinalScoreEl.textContent = `${remoteFinalScore}s`;
                    }
                    break;
                case 'READY': remotePlayerReady = true; connectionStatusEl.textContent = `Opponent is ready!`; checkIfBothReady(); break;
            }
        });
        gameConn.on('close', () => { 
            alert('Opponent disconnected.'); 
            gameConn = null; 
            resetGame('single_player'); 
            updateUserList(lobbyPeers);
        });
    }

    function playerReady() {
        if (!gameConn) return;
        if (gameConn.open) {
            localPlayerReady = true;
            gameConn.send({ type: 'READY' });
            newGameButton.disabled = true; newGameButton.textContent = 'Waiting...';
            checkIfBothReady();
        } else {
            gameConn.once('open', playerReady);
        }
    }

    function checkIfBothReady() { if (localPlayerReady && remotePlayerReady) resetGame('multiplayer_playing'); }

    function updateUserList(peerIds) {
        userListEl.innerHTML = '';
        peerIds.forEach(id => {
            if (id === myPeerId || id.includes('HOST-HOST')) {
                return; // Skip myself and the easter egg
            }

            const li = document.createElement('li');
            li.textContent = id;
            const button = document.createElement('button');
            li.appendChild(button);
            userListEl.appendChild(li);

            const isConnectedToThisPeer = gameConn && gameConn.open && gameConn.peer === id;

            if (isConnectedToThisPeer) {
                button.textContent = 'Connected';
                button.disabled = true;
            } else {
                button.textContent = 'Connect';
                button.disabled = !!gameConn; // Disable if already in a game with someone else
                button.onclick = () => {
                    isHost = false;
                    setupGameConnection(peer.connect(id, { reliable: true }));
                };
            }
        });
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
            if (gameConn) {
                alert("You are already connected to a player.");
                return;
            }
            isHost = false;
            setupGameConnection(peer.connect(remoteId, { reliable: true }));
        }
    });

    newGameButton.addEventListener('click', () => {
        if (gameConn) { playerReady(); } 
        else { resetGame('single_player'); }
    });

    window.addEventListener('keydown', e => { if (e.code === 'Space') jump(); });
    canvas.addEventListener('click', jump);
});