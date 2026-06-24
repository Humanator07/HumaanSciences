/* =====================================================================
   FLAGBEARERS — 3D Bow Shooter Capture-the-Flag
   Single-file game engine built on three.js r128
===================================================================== */

(() => {
'use strict';

// ---------------------------------------------------------------------
// Globals & constants
// ---------------------------------------------------------------------
const TEAM = { CRIMSON: 'crimson', AZURE: 'azure' };
const TEAM_COLOR = { crimson: 0x8B2635, azure: 0x2A4858 };
const TEAM_COLOR_BRIGHT = { crimson: 0xc0392b, azure: 0x4a90b8 };
const ARENA_HALF = 60;
const SCORE_TO_WIN = 3;

let scene, camera, renderer, clock;
let playerTeam = TEAM.CRIMSON;
let gameStarted = false;
let gameOver = false;
let isMobile = /iPad|iPhone|iPod|Android/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));

let keys = {};
let mouseDown = false;
let yaw = 0, pitch = 0;
let charging = false, chargeStart = 0;
const MAX_CHARGE = 1.1; // seconds for full draw

let player = {
  pos: new THREE.Vector3(0, 1.7, 0),
  vel: new THREE.Vector3(0,0,0),
  height: 1.7,
  radius: 0.45,
  onGround: true,
  health: 100,
  ammo: 12,
  maxAmmo: 12,
  carryingFlag: null, // 'crimson' | 'azure' | null
  alive: true,
  respawnTimer: 0,
  team: TEAM.CRIMSON,
  rig: null,
};

let bots = [];        // AI controlled players
let arrows = [];       // active flying arrows
let flags = {};        // team -> {base pos, holder, mesh, carried bool}
let scores = { crimson: 0, azure: 0 };
let colliders = [];    // {minX,maxX,minZ,maxZ,minY,maxY} world AABBs for ruins/walls
let groundY = 0;

// ---------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const titleScreen = $('titleScreen');
const hud = $('hud');
const endScreen = $('endScreen');
const canvas = $('gameCanvas');
const centerMsg = $('centerMsg');
const flagBanner = $('flagBanner');
const carryVignette = $('carryVignette');
const chargeEl = $('charge');
const chargeFill = $('chargeFill');
const healthFill = $('healthFill');
const ammoCount = $('ammoCount');
const mobileControls = $('mobileControls');
const joystick = $('joystick');
const joystickKnob = $('joystickKnob');
const fireBtn = $('fireBtn');
const jumpBtn = $('jumpBtn');
const fsBtn = $('fsBtn');

// ---------------------------------------------------------------------
// Team selection on title screen
// ---------------------------------------------------------------------
document.querySelectorAll('.teamCard').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.teamCard').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    playerTeam = card.dataset.team;
  });
});

$('startBtn').addEventListener('click', () => {
  startGame();
});

$('playAgainBtn').addEventListener('click', () => {
  location.reload();
});

fsBtn.addEventListener('click', () => {
  requestFullscreenAndLock();
});

// ---------------------------------------------------------------------
// Fullscreen + iPad handling
// ---------------------------------------------------------------------
function requestFullscreenAndLock(){
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen || el.webkitRequestFullScreen || el.mozRequestFullScreen || el.msRequestFullscreen;
  if (req) {
    try {
      const p = req.call(el);
      if (p && p.then) p.catch(()=>{});
    } catch(e){}
  }
  if (screen.orientation && screen.orientation.lock) {
    screen.orientation.lock('landscape').catch(()=>{});
  }
}

function checkOrientation(){
  const lock = $('orientLock');
  if (!gameStarted) { lock.classList.remove('armed'); return; }
  lock.classList.add('armed');
}
window.addEventListener('resize', checkOrientation);
window.addEventListener('orientationchange', checkOrientation);

// ---------------------------------------------------------------------
// Scene setup
// ---------------------------------------------------------------------
function initScene(){
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fb4c2);
  scene.fog = new THREE.Fog(0xb9c7cf, 35, 110);

  camera = new THREE.PerspectiveCamera(72, window.innerWidth/window.innerHeight, 0.1, 300);

  renderer = new THREE.WebGLRenderer({ canvas, antialias:true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  clock = new THREE.Clock();

  // Lighting — warm late-afternoon, 1700s ruin mood
  const hemi = new THREE.HemisphereLight(0xcdd8df, 0x4a4233, 0.65);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffe9c2, 1.15);
  sun.position.set(40, 60, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048,2048);
  sun.shadow.camera.left = -80;
  sun.shadow.camera.right = 80;
  sun.shadow.camera.top = 80;
  sun.shadow.camera.bottom = -80;
  sun.shadow.camera.far = 200;
  sun.shadow.bias = -0.0015;
  scene.add(sun);

  const amb = new THREE.AmbientLight(0x404040, 0.35);
  scene.add(amb);

  buildGround();
  buildRuins();
  buildSkyDome();
  buildFlags();

  window.addEventListener('resize', onResize);
}

function onResize(){
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function buildSkyDome(){
  const geo = new THREE.SphereGeometry(150, 24, 16);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xaec4cf, side: THREE.BackSide, fog:false
  });
  const dome = new THREE.Mesh(geo, mat);
  scene.add(dome);

  // simple gradient via vertex colors substitute: a soft horizon ring
  const ringGeo = new THREE.RingGeometry(60, 150, 32);
  const ringMat = new THREE.MeshBasicMaterial({color:0xd8c9a8, transparent:true, opacity:0.25, side:THREE.DoubleSide});
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI/2;
  ring.position.y = 8;
  scene.add(ring);
}

function buildGround(){
  const segs = 64;
  const geo = new THREE.PlaneGeometry(ARENA_HALF*2+20, ARENA_HALF*2+20, segs, segs);
  geo.rotateX(-Math.PI/2);
  const pos = geo.attributes.position;
  for (let i=0;i<pos.count;i++){
    const x = pos.getX(i), z = pos.getZ(i);
    const h = (Math.sin(x*0.08)*Math.cos(z*0.07))*0.4 + (Math.sin(x*0.21+z*0.15))*0.15;
    pos.setY(i, h);
  }
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ color:0x7c8a5c, roughness:1, metalness:0 });
  const ground = new THREE.Mesh(geo, mat);
  ground.receiveShadow = true;
  scene.add(ground);

  // dirt path strip down the middle
  const pathGeo = new THREE.PlaneGeometry(8, ARENA_HALF*2, 1, 1);
  pathGeo.rotateX(-Math.PI/2);
  const pathMat = new THREE.MeshStandardMaterial({color:0x8a7857, roughness:1});
  const path = new THREE.Mesh(pathGeo, pathMat);
  path.position.y = 0.03;
  path.receiveShadow = true;
  scene.add(path);

  // scattered grass tufts (instanced-ish, simple cones)
  const tuftGeo = new THREE.ConeGeometry(0.18, 0.5, 4);
  const tuftMat = new THREE.MeshStandardMaterial({color:0x5f7a3f, roughness:1});
  for (let i=0;i<90;i++){
    const x = (Math.random()-0.5)*ARENA_HALF*1.9;
    const z = (Math.random()-0.5)*ARENA_HALF*1.9;
    if (Math.abs(x) < 5) continue;
    const t = new THREE.Mesh(tuftGeo, tuftMat);
    t.position.set(x, 0.2, z);
    t.rotation.y = Math.random()*Math.PI;
    t.castShadow = false;
    scene.add(t);
  }
}

// Stone material helper
function stoneMat(tint=0x8d8779){
  return new THREE.MeshStandardMaterial({ color:tint, roughness:0.95, metalness:0.05 });
}

function addCollider(mesh, x, z, w, d, yMin=0, yMax=20){
  colliders.push({
    minX:x-w/2, maxX:x+w/2,
    minZ:z-d/2, maxZ:z+d/2,
    minY:yMin, maxY:yMax,
    mesh
  });
}

function pillar(x,z,h=5,r=0.55){
  const g = new THREE.CylinderGeometry(r, r*1.15, h, 10);
  const m = new THREE.Mesh(g, stoneMat(0x948c7c));
  m.position.set(x, h/2, z);
  m.castShadow = true; m.receiveShadow = true;
  scene.add(m);
  addCollider(m, x, z, r*2.1, r*2.1, 0, h);

  // broken capital
  const capGeo = new THREE.BoxGeometry(r*2.6, 0.4, r*2.6);
  const cap = new THREE.Mesh(capGeo, stoneMat(0x9a9382));
  cap.position.set(x, h+0.2, z);
  cap.rotation.y = Math.random()*0.3;
  cap.castShadow = true;
  scene.add(cap);
}

function wallSegment(x,z,w,h,d,rotY=0, tint=0x7d7666){
  const g = new THREE.BoxGeometry(w,h,d);
  const m = new THREE.Mesh(g, stoneMat(tint));
  m.position.set(x,h/2,z);
  m.rotation.y = rotY;
  m.castShadow = true; m.receiveShadow = true;
  scene.add(m);
  // axis-aligned approx collider (rotate-aware for 0/90deg walls which is all we use)
  const ww = Math.abs(Math.cos(rotY))*w + Math.abs(Math.sin(rotY))*d;
  const dd = Math.abs(Math.sin(rotY))*w + Math.abs(Math.cos(rotY))*d;
  addCollider(m, x, z, ww, dd, 0, h);
}

function archway(x,z,rotY=0){
  // two pillars + lintel forming a ruined arch (good cover + sightline break)
  const off = 2.2;
  const dx = Math.cos(rotY)*off, dz = -Math.sin(rotY)*off;
  pillar(x+dx, z+dz, 4.2, 0.5);
  pillar(x-dx, z-dz, 4.2, 0.5);
  const lintelGeo = new THREE.BoxGeometry(off*2+1, 0.6, 0.9);
  const lintel = new THREE.Mesh(lintelGeo, stoneMat(0x83795f));
  lintel.position.set(x, 4.5, z);
  lintel.rotation.y = rotY;
  lintel.castShadow = true;
  scene.add(lintel);
}

function ruinedTower(x,z){
  // cylindrical broken tower, partial height, walkable-around cover
  const h = 6.5;
  const g = new THREE.CylinderGeometry(2.6, 2.9, h, 14, 1, true);
  const mat = stoneMat(0x8a8270);
  mat.side = THREE.DoubleSide;
  const tower = new THREE.Mesh(g, mat);
  tower.position.set(x, h/2, z);
  tower.castShadow = true; tower.receiveShadow = true;
  // jagged top via scale trick is complex; leave as broken cylinder silhouette
  scene.add(tower);
  addCollider(tower, x, z, 5.8, 5.8, 0, h); // ring collider approximated as block (fine for gameplay)

  // rubble pile at base
  const rubbleGeo = new THREE.DodecahedronGeometry(1.1, 0);
  for (let i=0;i<5;i++){
    const r = new THREE.Mesh(rubbleGeo, stoneMat(0x756c5c));
    const a = Math.random()*Math.PI*2;
    r.position.set(x+Math.cos(a)*3.2, 0.4, z+Math.sin(a)*3.2);
    r.rotation.set(Math.random(),Math.random(),Math.random());
    r.scale.setScalar(0.5+Math.random()*0.6);
    r.castShadow = true;
    scene.add(r);
  }
}

function lowWall(x,z,w,rotY=0){
  wallSegment(x,z,w,1.1,0.6,rotY,0x726c5d);
}

function buildRuins(){
  // Central spine: low walls and rubble offering mid-field cover, mirrored
  // symmetric so neither team has terrain advantage.

  // Central ruined courtyard towers
  ruinedTower(0, -14);
  ruinedTower(0, 14);

  // Crossing archways near center
  archway(-6, 0, Math.PI/2);
  archway(6, 0, Math.PI/2);

  // Mid-field low walls (cover while crossing)
  lowWall(-14, -6, 9, 0.3);
  lowWall(14, 6, 9, 0.3);
  lowWall(-14, 6, 9, -0.3);
  lowWall(14, -6, 9, -0.3);

  // Pillar avenues leading to each base
  for (let i=-1;i<=1;i+=2){
    pillar(-30, i*10, 4.6, 0.5);
    pillar(30, i*10, 4.6, 0.5);
  }

  // Outer perimeter broken wall (keeps arena readable, not a hard box)
  wallSegment(0, -ARENA_HALF, ARENA_HALF*2, 3.2, 1, 0, 0x6c6555);
  wallSegment(0, ARENA_HALF, ARENA_HALF*2, 3.2, 1, 0, 0x6c6555);
  wallSegment(-ARENA_HALF, 0, ARENA_HALF*2, 3.2, 1, Math.PI/2, 0x6c6555);
  wallSegment(ARENA_HALF, 0, ARENA_HALF*2, 3.2, 1, Math.PI/2, 0x6c6555);

  // Base structures — crimson east (+x), azure west (-x)
  buildBaseStructure(38, TEAM.CRIMSON);
  buildBaseStructure(-38, TEAM.AZURE);

  // scattered crates/barrels for additional micro-cover near bases
  scatterProps(28, TEAM.CRIMSON);
  scatterProps(-28, TEAM.AZURE);

  // some trees for atmosphere off to the sides
  for (let i=0;i<14;i++){
    const side = Math.random()<0.5?-1:1;
    const x = side*(ARENA_HALF-6) - side*Math.random()*8;
    const z = (Math.random()-0.5)*ARENA_HALF*1.8;
    tree(x,z);
  }
}

function tree(x,z){
  const trunkGeo = new THREE.CylinderGeometry(0.25,0.32,3,6);
  const trunk = new THREE.Mesh(trunkGeo, new THREE.MeshStandardMaterial({color:0x4a3a28,roughness:1}));
  trunk.position.set(x,1.5,z);
  trunk.castShadow = true;
  scene.add(trunk);
  const leafGeo = new THREE.ConeGeometry(1.6,3.2,7);
  const leaf = new THREE.Mesh(leafGeo, new THREE.MeshStandardMaterial({color:0x3f5a2e,roughness:1}));
  leaf.position.set(x,3.6,z);
  leaf.castShadow = true;
  scene.add(leaf);
  addCollider(trunk, x, z, 0.6, 0.6, 0, 3);
}

function buildBaseStructure(x, team){
  const tint = team===TEAM.CRIMSON ? 0x7d5a52 : 0x57707d;
  // raised stone dais for the flag
  const daisGeo = new THREE.CylinderGeometry(3.4, 3.8, 0.6, 16);
  const dais = new THREE.Mesh(daisGeo, stoneMat(0x8d8779));
  dais.position.set(x, 0.3, 0);
  dais.receiveShadow = true; dais.castShadow = true;
  scene.add(dais);

  // back wall behind base for visual identity + cover
  wallSegment(x + (team===TEAM.CRIMSON?6:-6), 0, 1, 5.5, 14, 0, tint);

  // two flanking pillars
  pillar(x, -7, 5.2, 0.55);
  pillar(x, 7, 5.2, 0.55);
}

function scatterProps(centerX, team){
  const crateGeo = new THREE.BoxGeometry(1,1,1);
  const crateMat = new THREE.MeshStandardMaterial({color:0x6b4f33, roughness:1});
  for (let i=0;i<5;i++){
    const c = new THREE.Mesh(crateGeo, crateMat);
    const x = centerX + (Math.random()-0.5)*10;
    const z = (Math.random()-0.5)*16;
    c.position.set(x, 0.5, z);
    c.rotation.y = Math.random()*Math.PI;
    c.castShadow = true; c.receiveShadow = true;
    scene.add(c);
    addCollider(c, x, z, 1, 1, 0, 1);
  }
  const barrelGeo = new THREE.CylinderGeometry(0.4,0.45,0.9,10);
  const barrelMat = new THREE.MeshStandardMaterial({color:0x53432e, roughness:1});
  for (let i=0;i<3;i++){
    const b = new THREE.Mesh(barrelGeo, barrelMat);
    const x = centerX + (Math.random()-0.5)*10;
    const z = (Math.random()-0.5)*16;
    b.position.set(x, 0.45, z);
    b.castShadow = true; b.receiveShadow = true;
    scene.add(b);
    addCollider(b, x, z, 0.9, 0.9, 0, 0.9);
  }
}

// ---------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------
function buildFlags(){
  flags[TEAM.CRIMSON] = makeFlag(TEAM.CRIMSON, new THREE.Vector3(38, 0, 0));
  flags[TEAM.AZURE] = makeFlag(TEAM.AZURE, new THREE.Vector3(-38, 0, 0));
}

function makeFlag(team, basePos){
  const group = new THREE.Group();
  const poleGeo = new THREE.CylinderGeometry(0.07,0.07,4.2,6);
  const poleMat = new THREE.MeshStandardMaterial({color:0x3a2f22, roughness:0.8});
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.y = 2.1;
  pole.castShadow = true;
  group.add(pole);

  const clothGeo = new THREE.PlaneGeometry(1.5,1.0,6,4);
  const clothMat = new THREE.MeshStandardMaterial({
    color: TEAM_COLOR_BRIGHT[team], roughness:0.9, side:THREE.DoubleSide
  });
  const cloth = new THREE.Mesh(clothGeo, clothMat);
  cloth.position.set(0.78, 3.5, 0);
  cloth.castShadow = true;
  cloth.userData.basePos = cloth.position.clone();
  group.add(cloth);

  group.position.copy(basePos);
  group.position.y = 0.3;
  scene.add(group);

  return {
    team,
    basePos: basePos.clone(),
    group,
    cloth,
    holder: null,      // 'player' | botRef | null
    carried: false,
    atBase: true,
  };
}

function animateFlagCloth(flag, t){
  const cloth = flag.cloth;
  const base = cloth.userData.basePos;
  const pos = cloth.geometry.attributes.position;
  for (let i=0;i<pos.count;i++){
    const x = pos.getX(i);
    const wave = Math.sin(t*4 + x*2.2) * 0.05 * (x+0.75);
    pos.setZ(i, wave);
  }
  pos.needsUpdate = true;
}

// ---------------------------------------------------------------------
// Player & Bot rigs (simple stylized humanoid, low-poly, team colored)
// ---------------------------------------------------------------------
function buildRig(team, isPlayer=false){
  const g = new THREE.Group();
  const color = TEAM_COLOR[team];
  const bodyMat = new THREE.MeshStandardMaterial({color, roughness:0.8});
  const skinMat = new THREE.MeshStandardMaterial({color:0xd2a679, roughness:0.9});
  const darkMat = new THREE.MeshStandardMaterial({color:0x2b261f, roughness:0.9});

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32,0.6,4,8), bodyMat);
  torso.position.y = 1.05;
  torso.castShadow = true;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26,10,10), skinMat);
  head.position.y = 1.62;
  head.castShadow = true;
  g.add(head);

  // tricorne-ish hat
  const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.34,0.34,0.05,10), darkMat);
  hatBrim.position.y = 1.78;
  hatBrim.castShadow = true;
  g.add(hatBrim);
  const hatTop = new THREE.Mesh(new THREE.ConeGeometry(0.2,0.22,8), darkMat);
  hatTop.position.y = 1.92;
  g.add(hatTop);

  const legGeo = new THREE.CapsuleGeometry(0.13,0.55,4,6);
  const legL = new THREE.Mesh(legGeo, darkMat);
  legL.position.set(-0.16, 0.42, 0);
  legL.castShadow = true;
  g.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.16;
  g.add(legR);

  const armGeo = new THREE.CapsuleGeometry(0.11,0.5,4,6);
  const armL = new THREE.Mesh(armGeo, bodyMat);
  armL.position.set(-0.42, 1.1, 0);
  armL.castShadow = true;
  g.add(armL);
  const armR = armL.clone();
  armR.position.x = 0.42;
  g.add(armR);

  // bow (held in front, attached loosely to right arm group for simplicity)
  const bowGroup = new THREE.Group();
  const bowCurve = new THREE.Mesh(
    new THREE.TorusGeometry(0.42, 0.025, 6, 12, Math.PI*1.15),
    new THREE.MeshStandardMaterial({color:0x4a3623, roughness:0.7})
  );
  bowCurve.rotation.z = Math.PI/2;
  bowGroup.add(bowCurve);
  bowGroup.position.set(0.42, 1.15, 0.25);
  g.add(bowGroup);

  // flag-carry indicator slot (small banner on back when carrying)
  const carryFlag = new THREE.Group();
  const cPole = new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,1.1,5), new THREE.MeshStandardMaterial({color:0x3a2f22}));
  cPole.position.y = 0.55;
  carryFlag.add(cPole);
  carryFlag.position.set(0,1.3,-0.3);
  carryFlag.visible = false;
  g.add(carryFlag);

  g.userData = { legL, legR, armL, armR, bowGroup, head, carryFlag, team };
  g.castShadow = true;
  scene.add(g);
  return g;
}

// ---------------------------------------------------------------------
// Arrows
// ---------------------------------------------------------------------
const arrowGeo = new THREE.CylinderGeometry(0.025,0.025,0.85,5);
arrowGeo.rotateX(Math.PI/2);
const arrowTipGeo = new THREE.ConeGeometry(0.045,0.14,5);
arrowTipGeo.rotateX(Math.PI/2);

function spawnArrow(originPos, dir, owner){
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(arrowGeo, new THREE.MeshStandardMaterial({color:0x4a3623}));
  g.add(shaft);
  const tip = new THREE.Mesh(arrowTipGeo, new THREE.MeshStandardMaterial({color:0x888888, metalness:0.6, roughness:0.4}));
  tip.position.z = 0.49;
  g.add(tip);

  g.position.copy(originPos);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1), dir.clone().normalize());
  g.quaternion.copy(q);
  scene.add(g);

  arrows.push({
    mesh:g,
    vel: dir.clone().normalize().multiplyScalar(38),
    life: 3.2,
    owner, // 'player' or bot ref
    ownerTeam: owner === 'player' ? player.team : owner.team,
    spent:false,
  });
}

function updateArrows(dt){
  for (let i=arrows.length-1;i>=0;i--){
    const a = arrows[i];
    a.life -= dt;
    if (a.life<=0 || a.spent){ scene.remove(a.mesh); arrows.splice(i,1); continue; }

    a.vel.y -= 9.8*dt; // gravity arc
    const step = a.vel.clone().multiplyScalar(dt);
    a.mesh.position.add(step);
    if (step.lengthSq()>0.0001){
      const dir = step.clone().normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1), dir);
      a.mesh.quaternion.slerp(q, 0.6);
    }

    if (a.mesh.position.y < 0.05){ a.spent=true; continue; }

    // collide with world colliders (stop arrow)
    for (const c of colliders){
      if (a.mesh.position.x>c.minX && a.mesh.position.x<c.maxX &&
          a.mesh.position.z>c.minZ && a.mesh.position.z<c.maxZ &&
          a.mesh.position.y>c.minY && a.mesh.position.y<c.maxY){
        a.spent = true; break;
      }
    }
    if (a.spent) continue;

    // collide with player
    if (a.ownerTeam !== player.team && player.alive){
      const d = a.mesh.position.distanceTo(player.pos.clone().setY(player.pos.y));
      if (d < 0.55 && Math.abs(a.mesh.position.y - (player.pos.y)) < 1.1){
        damagePlayer(18);
        a.spent = true; continue;
      }
    }
    // collide with bots
    for (const b of bots){
      if (!b.alive) continue;
      if (a.ownerTeam === b.team) continue;
      if (a.owner === b) continue;
      const d = a.mesh.position.distanceTo(b.pos);
      if (d < 0.55 && Math.abs(a.mesh.position.y - b.pos.y) < 1.1){
        damageBot(b, 30);
        a.spent = true; break;
      }
    }
  }
}

// ---------------------------------------------------------------------
// Input handling
// ---------------------------------------------------------------------
window.addEventListener('keydown', e => {
  // Panic shortcut: leaves the game instantly, no matter what's happening.
  if (e.shiftKey && e.code === 'KeyQ') {
    window.location.replace('../index.html');
    return;
  }
  keys[e.code] = true;
  if (e.code==='KeyE') tryInteract();
  if (e.code==='Space') { e.preventDefault(); tryJump(); }
});
window.addEventListener('keyup', e => keys[e.code]=false);

canvas.addEventListener('mousedown', e => {
  if (!gameStarted || gameOver) return;
  if (document.pointerLockElement !== canvas) {
    canvas.requestPointerLock?.();
  }
  beginCharge();
});
window.addEventListener('mouseup', () => { if(gameStarted) releaseCharge(); });
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement === canvas){
    yaw -= e.movementX * 0.0028;
    pitch -= e.movementY * 0.0028;
    pitch = Math.max(-1.2, Math.min(1.2, pitch));
  }
});

// Touch look (drag anywhere not on controls)
let touchLookId = null, lastTX=0, lastTY=0;
canvas.addEventListener('touchstart', e => {
  if (!gameStarted) return;
  for (const t of e.changedTouches){
    if (touchLookId===null){
      touchLookId = t.identifier; lastTX=t.clientX; lastTY=t.clientY;
    }
  }
}, {passive:true});
canvas.addEventListener('touchmove', e => {
  for (const t of e.changedTouches){
    if (t.identifier===touchLookId){
      const dx = t.clientX-lastTX, dy = t.clientY-lastTY;
      yaw -= dx*0.0045;
      pitch -= dy*0.0045;
      pitch = Math.max(-1.2, Math.min(1.2, pitch));
      lastTX=t.clientX; lastTY=t.clientY;
    }
  }
}, {passive:true});
canvas.addEventListener('touchend', e => {
  for (const t of e.changedTouches){
    if (t.identifier===touchLookId) touchLookId=null;
  }
}, {passive:true});

// Mobile joystick
let joyActive=false, joyId=null, joyCenter={x:0,y:0}, joyVec={x:0,y:0};
joystick.addEventListener('touchstart', e => {
  e.preventDefault();
  const t = e.changedTouches[0];
  joyId = t.identifier;
  const r = joystick.getBoundingClientRect();
  joyCenter = {x:r.left+r.width/2, y:r.top+r.height/2};
  joyActive = true;
}, {passive:false});
window.addEventListener('touchmove', e => {
  for (const t of e.changedTouches){
    if (t.identifier===joyId){
      let dx = t.clientX-joyCenter.x, dy = t.clientY-joyCenter.y;
      const max=46;
      const len = Math.hypot(dx,dy);
      if (len>max){ dx=dx/len*max; dy=dy/len*max; }
      joystickKnob.style.transform = `translate(${dx}px,${dy}px)`;
      joyVec = {x:dx/max, y:dy/max};
    }
  }
}, {passive:true});
window.addEventListener('touchend', e => {
  for (const t of e.changedTouches){
    if (t.identifier===joyId){
      joyActive=false; joyId=null; joyVec={x:0,y:0};
      joystickKnob.style.transform = 'translate(0,0)';
    }
  }
}, {passive:true});

fireBtn.addEventListener('touchstart', e => { e.preventDefault(); beginCharge(); }, {passive:false});
fireBtn.addEventListener('touchend', e => { e.preventDefault(); releaseCharge(); }, {passive:false});
jumpBtn.addEventListener('touchstart', e => { e.preventDefault(); tryJump(); }, {passive:false});

function beginCharge(){
  if (!player.alive || gameOver) return;
  if (player.ammo<=0) return;
  charging = true;
  chargeStart = performance.now();
  chargeEl.classList.add('show');
}
function releaseCharge(){
  if (!charging) return;
  charging = false;
  chargeEl.classList.remove('show');
  if (!player.alive || gameOver) { return; }
  if (player.ammo<=0) return;
  const held = Math.min((performance.now()-chargeStart)/1000, MAX_CHARGE);
  const power = 0.35 + 0.65*(held/MAX_CHARGE); // min draw still fires, full draw = full power
  fireArrowFromPlayer(power);
}

function fireArrowFromPlayer(power){
  player.ammo--;
  ammoCount.textContent = player.ammo;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const origin = camera.position.clone().add(dir.clone().multiplyScalar(0.6));
  origin.y -= 0.05;
  const arrowDir = dir.clone();
  // slight upward compensation scaled by inverse power (weaker draw arcs more)
  arrowDir.y += (1-power)*0.12;
  spawnArrow(origin, arrowDir, 'player');
  // scale velocity by power via temp hack: adjust last arrow
  const last = arrows[arrows.length-1];
  last.vel.multiplyScalar(0.55 + power*0.7);
}

function tryJump(){
  if (player.onGround && player.alive){
    player.vel.y = 5.2;
    player.onGround = false;
  }
}

function tryInteract(){
  if (!player.alive) return;
  const enemyTeam = player.team===TEAM.CRIMSON?TEAM.AZURE:TEAM.CRIMSON;
  const enemyFlag = flags[enemyTeam];
  const ownFlag = flags[player.team];

  // pick up enemy flag
  if (!player.carryingFlag && !enemyFlag.carried){
    const d = player.pos.distanceTo(enemyFlag.group.position);
    if (d < 2.6){
      enemyFlag.carried = true;
      enemyFlag.atBase = false;
      enemyFlag.holder = 'player';
      player.carryingFlag = enemyTeam;
      player.rig.userData.carryFlag.visible = true;
      showFlagBanner(`You have seized the ${teamLabel(enemyTeam)} banner!`);
      carryVignette.classList.add('active');
      updateFlagStatusUI();
      return;
    }
  }

  // return enemy flag while carrying it, if standing at own base AND own flag is at base
  if (player.carryingFlag){
    const d = player.pos.distanceTo(ownFlag.group.position);
    if (d < 3 && ownFlag.atBase){
      scoreCapture(player.team);
      return;
    }
  }
}

function teamLabel(t){ return t===TEAM.CRIMSON?'Crimson':'Azure'; }

function scoreCapture(scoringTeam){
  scores[scoringTeam]++;
  const capturedFlagTeam = scoringTeam===TEAM.CRIMSON?TEAM.AZURE:TEAM.CRIMSON;
  resetFlag(capturedFlagTeam);
  if (player.carryingFlag===capturedFlagTeam){
    player.carryingFlag = null;
    player.rig.userData.carryFlag.visible = false;
    carryVignette.classList.remove('active');
  }
  bots.forEach(b => { if (b.carryingFlag===capturedFlagTeam){ b.carryingFlag=null; b.rig.userData.carryFlag.visible=false; } });

  updateScoreUI();
  showCenterMsg(`${teamLabel(scoringTeam)} captures the flag!`);
  if (scores[scoringTeam]>=SCORE_TO_WIN){
    endGame(scoringTeam);
  }
}

function resetFlag(team){
  const f = flags[team];
  f.carried = false;
  f.atBase = true;
  f.holder = null;
  f.group.position.set(f.basePos.x, 0.3, f.basePos.z);
}

function updateFlagStatusUI(){
  const cf = flags[TEAM.CRIMSON], af = flags[TEAM.AZURE];
  const elC = $('flagCrimson'), elA = $('flagAzure');
  elC.textContent = cf.atBase ? 'Banner Secure' : 'Banner Taken';
  elC.classList.toggle('held', !cf.atBase);
  elA.textContent = af.atBase ? 'Banner Secure' : 'Banner Taken';
  elA.classList.toggle('held', !af.atBase);
}

function updateScoreUI(){
  $('scoreCrimson').textContent = scores.crimson;
  $('scoreAzure').textContent = scores.azure;
}

function showCenterMsg(txt){
  centerMsg.textContent = txt;
  centerMsg.classList.add('show');
  clearTimeout(centerMsg._t);
  centerMsg._t = setTimeout(()=>centerMsg.classList.remove('show'), 2200);
}
function showFlagBanner(txt){
  flagBanner.textContent = txt;
  flagBanner.classList.add('show');
  clearTimeout(flagBanner._t);
  flagBanner._t = setTimeout(()=>flagBanner.classList.remove('show'), 2400);
}

// ---------------------------------------------------------------------
// Player movement & physics
// ---------------------------------------------------------------------
function moveVecFromInput(){
  let x=0,z=0;
  if (keys['KeyW']) z -= 1;
  if (keys['KeyS']) z += 1;
  if (keys['KeyA']) x -= 1;
  if (keys['KeyD']) x += 1;
  if (isMobile){
    x += joyVec.x;
    z += joyVec.y;
  }
  const len = Math.hypot(x,z);
  if (len>1){ x/=len; z/=len; }
  return {x,z};
}

function resolveCollisions(pos, radius){
  for (const c of colliders){
    const closestX = Math.max(c.minX, Math.min(pos.x, c.maxX));
    const closestZ = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
    const dx = pos.x-closestX, dz = pos.z-closestZ;
    const distSq = dx*dx+dz*dz;
    if (distSq < radius*radius && pos.y < c.maxY+0.1){
      const dist = Math.sqrt(distSq)||0.0001;
      const overlap = radius-dist;
      pos.x += (dx/dist)*overlap;
      pos.z += (dz/dist)*overlap;
    }
  }
  pos.x = Math.max(-ARENA_HALF+1, Math.min(ARENA_HALF-1, pos.x));
  pos.z = Math.max(-ARENA_HALF+1, Math.min(ARENA_HALF-1, pos.z));
}

function updatePlayer(dt){
  if (!player.alive){
    player.respawnTimer -= dt;
    if (player.respawnTimer<=0) respawnPlayer();
    return;
  }
  const {x,z} = moveVecFromInput();
  const speed = 6.2;
  const forward = new THREE.Vector3(Math.sin(yaw),0,Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
  const move = new THREE.Vector3();
  move.addScaledVector(forward, -z);
  move.addScaledVector(right, x);
  if (move.lengthSq()>0){ move.normalize().multiplyScalar(speed*dt); }

  player.pos.x += move.x;
  player.pos.z += move.z;
  resolveCollisions(player.pos, player.radius);

  // gravity
  player.vel.y -= 16*dt;
  player.pos.y += player.vel.y*dt;
  const groundLevel = 1.7;
  if (player.pos.y <= groundLevel){
    player.pos.y = groundLevel;
    player.vel.y = 0;
    player.onGround = true;
  }

  camera.position.copy(player.pos);
  camera.rotation.order='YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;

  // update rig (third person mesh used only for bots seeing player & for carry flag visual)
  player.rig.position.set(player.pos.x, player.pos.y-1.7, player.pos.z);
  player.rig.rotation.y = yaw;
  animateWalk(player.rig, move.length()>0.001, performance.now()*0.01);

  // flag follows if carrying
  if (player.carryingFlag){
    const f = flags[player.carryingFlag];
    const back = new THREE.Vector3(0,1.3,-0.4).applyAxisAngle(new THREE.Vector3(0,1,0), yaw);
    f.group.position.set(player.pos.x+back.x, player.pos.y-1.7+back.y, player.pos.z+back.z);
    f.group.rotation.y = yaw;
  }
}

function damagePlayer(amt){
  if (!player.alive) return;
  player.health -= amt;
  healthFill.style.width = Math.max(0,player.health)+'%';
  flashDamage();
  if (player.health<=0){
    killPlayer();
  }
}

function flashDamage(){
  carryVignette.style.boxShadow = 'inset 0 0 200px 60px rgba(180,30,30,0.5)';
  setTimeout(()=>{
    carryVignette.style.boxShadow = player.carryingFlag ? '' : 'inset 0 0 160px 40px rgba(201,162,39,0)';
    if(player.carryingFlag) carryVignette.classList.add('active');
  },180);
}

function killPlayer(){
  player.alive = false;
  player.respawnTimer = 3;
  showCenterMsg('You have fallen — respawning…');
  if (player.carryingFlag){
    // drop flag at death location
    const f = flags[player.carryingFlag];
    f.group.position.set(player.pos.x, 0.3, player.pos.z);
    f.carried = false;
    f.holder = null;
    player.carryingFlag = null;
    player.rig.userData.carryFlag.visible = false;
    carryVignette.classList.remove('active');
    updateFlagStatusUI();
  }
  player.rig.visible = false;
}

function respawnPlayer(){
  player.alive = true;
  player.health = 100;
  player.ammo = player.maxAmmo;
  healthFill.style.width='100%';
  ammoCount.textContent = player.ammo;
  const base = flags[player.team].basePos;
  player.pos.set(base.x + (player.team===TEAM.CRIMSON?6:-6), 1.7, (Math.random()-0.5)*6);
  player.vel.set(0,0,0);
  player.rig.visible = true;
  showCenterMsg('Back on the field');
}

function animateWalk(rig, moving, t){
  const u = rig.userData;
  if (moving){
    u.legL.rotation.x = Math.sin(t)*0.5;
    u.legR.rotation.x = -Math.sin(t)*0.5;
    u.armL.rotation.x = -Math.sin(t)*0.4;
  } else {
    u.legL.rotation.x *= 0.8;
    u.legR.rotation.x *= 0.8;
    u.armL.rotation.x *= 0.8;
  }
}

// ---------------------------------------------------------------------
// AI Bots
// ---------------------------------------------------------------------
function spawnBots(){
  const countPerTeam = isMobile ? 2 : 3;
  [TEAM.CRIMSON, TEAM.AZURE].forEach(team => {
    for (let i=0;i<countPerTeam;i++){
      if (team===player.team && i===0) continue; // leave a slot since player fills one role conceptually (not strictly required)
      const base = flags[team].basePos;
      const bot = {
        team,
        pos: new THREE.Vector3(base.x + (team===TEAM.CRIMSON?6:-6), 1.0, (Math.random()-0.5)*16),
        vel: new THREE.Vector3(),
        health: 100,
        alive: true,
        respawnTimer:0,
        carryingFlag:null,
        rig: buildRig(team),
        state:'seekFlag', // seekFlag | returnFlag | guard | engage
        target:null,
        fireTimer: Math.random()*2,
        wanderAngle: Math.random()*Math.PI*2,
        wanderTimer: 0,
        aimYaw:0,
      };
      bots.push(bot);
    }
  });
}

function botEnemyTeam(b){ return b.team===TEAM.CRIMSON?TEAM.AZURE:TEAM.CRIMSON; }

function updateBots(dt){
  for (const b of bots){
    if (!b.alive){
      b.respawnTimer -= dt;
      if (b.respawnTimer<=0) respawnBot(b);
      continue;
    }
    botDecide(b);
    botMove(b, dt);
    botCombat(b, dt);
    botFlagInteract(b);

    b.rig.position.copy(b.pos).setY(b.pos.y-1.0);
    b.rig.rotation.y = b.aimYaw;
    animateWalk(b.rig, b.vel.length()>0.05, performance.now()*0.01 + b.wanderAngle*10);

    if (b.carryingFlag){
      const f = flags[b.carryingFlag];
      const back = new THREE.Vector3(0,1.3,-0.4).applyAxisAngle(new THREE.Vector3(0,1,0), b.aimYaw);
      f.group.position.set(b.pos.x+back.x, b.pos.y-1.0+back.y, b.pos.z+back.z);
      f.group.rotation.y = b.aimYaw;
    }
  }
}

function nearestEnemy(b){
  let best=null,bestD=Infinity;
  if (player.alive && player.team!==b.team){
    const d = b.pos.distanceTo(player.pos);
    if (d<bestD){bestD=d;best={pos:player.pos,isPlayer:true};}
  }
  for (const o of bots){
    if (o===b || !o.alive || o.team===b.team) continue;
    const d = b.pos.distanceTo(o.pos);
    if (d<bestD){bestD=d;best={pos:o.pos,ref:o,isPlayer:false};}
  }
  return best?{...best, dist:bestD}:null;
}

function botDecide(b){
  const enemyFlag = flags[botEnemyTeam(b)];
  const ownFlag = flags[b.team];

  if (b.carryingFlag){
    b.state = 'returnFlag';
  } else if (!enemyFlag.carried){
    b.state = 'seekFlag';
  } else if (!ownFlag.atBase){
    b.state = 'guard'; // chase down flag carrier going through home territory (simplified: roam own side)
  } else {
    b.state = 'seekFlag'; // keep pressuring since someone else's team has it, still try to help / fight
  }
}

function botMove(b, dt){
  const speed = 5.0;
  let targetPos = null;

  if (b.state==='returnFlag'){
    targetPos = flags[b.team].basePos;
  } else if (b.state==='seekFlag'){
    const ef = flags[botEnemyTeam(b)];
    targetPos = ef.carried ? null : ef.group.position;
    if (ef.carried && ef.holder!=='player'){
      // chase whoever's carrying it if it's a bot on the other team... actually if carried by enemy, hunt them
    }
  } else if (b.state==='guard'){
    targetPos = flags[b.team].basePos;
  }

  const enemy = nearestEnemy(b);
  let moveTarget = targetPos;

  // if enemy spotted within engage range, prioritize tactical positioning over pure pathing
  if (enemy && enemy.dist < 26){
    b.aimYaw = Math.atan2(enemy.pos.x-b.pos.x, enemy.pos.z-b.pos.z);
    if (enemy.dist < 9){
      // back off a bit to keep bow range
      moveTarget = new THREE.Vector3(
        b.pos.x - (enemy.pos.x-b.pos.x)*0.5,
        0, b.pos.z - (enemy.pos.z-b.pos.z)*0.5
      );
    } else if (!moveTarget){
      moveTarget = enemy.pos;
    }
  }

  if (!moveTarget){
    // wander
    b.wanderTimer -= dt;
    if (b.wanderTimer<=0){ b.wanderAngle = Math.random()*Math.PI*2; b.wanderTimer=2+Math.random()*2; }
    moveTarget = new THREE.Vector3(b.pos.x+Math.sin(b.wanderAngle), 0, b.pos.z+Math.cos(b.wanderAngle));
  }

  const dir = new THREE.Vector3(moveTarget.x-b.pos.x, 0, moveTarget.z-b.pos.z);
  const dist = dir.length();
  if (dist>0.4){
    dir.normalize();
    b.vel.x = dir.x*speed;
    b.vel.z = dir.z*speed;
    if (!(enemy && enemy.dist<26)){
      b.aimYaw = Math.atan2(dir.x, dir.z);
    }
  } else {
    b.vel.x*=0.5; b.vel.z*=0.5;
  }

  b.pos.x += b.vel.x*dt;
  b.pos.z += b.vel.z*dt;
  resolveCollisions(b.pos, 0.45);
  b.pos.y = 1.0;
}

function botCombat(b, dt){
  b.fireTimer -= dt;
  const enemy = nearestEnemy(b);
  if (enemy && enemy.dist < 24 && b.fireTimer<=0){
    b.fireTimer = 1.1 + Math.random()*0.9;
    const dir = new THREE.Vector3(enemy.pos.x-b.pos.x, 0.15+enemy.dist*0.012, enemy.pos.z-b.pos.z).normalize();
    const origin = b.pos.clone(); origin.y = b.pos.y+0.6;
    const accuracySpread = 0.05;
    dir.x += (Math.random()-0.5)*accuracySpread;
    dir.z += (Math.random()-0.5)*accuracySpread;
    spawnArrow(origin, dir, b);
  }
}

function damageBot(b, amt){
  if (!b.alive) return;
  b.health -= amt;
  if (b.health<=0) killBot(b);
}

function killBot(b){
  b.alive = false;
  b.respawnTimer = 3;
  b.rig.visible = false;
  if (b.carryingFlag){
    const f = flags[b.carryingFlag];
    f.group.position.set(b.pos.x,0.3,b.pos.z);
    f.carried = false; f.holder=null;
    b.carryingFlag = null;
    b.rig.userData.carryFlag.visible = false;
    updateFlagStatusUI();
  }
}

function respawnBot(b){
  b.alive = true;
  b.health = 100;
  const base = flags[b.team].basePos;
  b.pos.set(base.x + (b.team===TEAM.CRIMSON?6:-6), 1.0, (Math.random()-0.5)*16);
  b.rig.visible = true;
}

function botFlagInteract(b){
  const enemyTeam = botEnemyTeam(b);
  const enemyFlag = flags[enemyTeam];
  const ownFlag = flags[b.team];

  if (!b.carryingFlag && !enemyFlag.carried){
    const d = b.pos.distanceTo(enemyFlag.group.position);
    if (d < 2.2){
      enemyFlag.carried = true;
      enemyFlag.atBase = false;
      enemyFlag.holder = b;
      b.carryingFlag = enemyTeam;
      b.rig.userData.carryFlag.visible = true;
      if (b.team !== player.team) showFlagBanner(`The ${teamLabel(b.team)} have taken your banner!`);
      updateFlagStatusUI();
      return;
    }
  }
  if (b.carryingFlag){
    const d = b.pos.distanceTo(ownFlag.group.position);
    if (d < 3 && ownFlag.atBase){
      scoreCapture(b.team);
    }
  }
}

// ---------------------------------------------------------------------
// End game
// ---------------------------------------------------------------------
function endGame(winningTeam){
  gameOver = true;
  document.exitPointerLock?.();
  $('endTitle').textContent = winningTeam===player.team ? 'Victory' : 'Defeat';
  $('endSub').textContent = `The ${teamLabel(winningTeam)} ${winningTeam===TEAM.CRIMSON?'Vanguard':'Watch'} has claimed the field, ${scores[winningTeam]} banners to ${scores[winningTeam===TEAM.CRIMSON?TEAM.AZURE:TEAM.CRIMSON]}.`;
  endScreen.style.display = 'flex';
}

// ---------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------
function animate(){
  requestAnimationFrame(animate);
  if (!gameStarted) return;
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  if (!gameOver){
    updatePlayer(dt);
    updateBots(dt);
    updateArrows(dt);
  }

  if (charging){
    const held = Math.min((performance.now()-chargeStart)/1000, MAX_CHARGE);
    chargeFill.style.width = (held/MAX_CHARGE*100)+'%';
  }

  animateFlagCloth(flags[TEAM.CRIMSON], t);
  animateFlagCloth(flags[TEAM.AZURE], t);

  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------
// Game start
// ---------------------------------------------------------------------
function startGame(){
  initScene();

  player.team = playerTeam;
  const base = flags[playerTeam].basePos;
  player.pos.set(base.x + (playerTeam===TEAM.CRIMSON?6:-6), 1.7, 0);
  yaw = playerTeam===TEAM.CRIMSON ? Math.PI/2 : -Math.PI/2;
  player.rig = buildRig(playerTeam, true);
  player.rig.visible = false; // first person: hide own rig (only used for flag-carry visual logic placeholder)

  spawnBots();
  updateScoreUI();
  updateFlagStatusUI();

  titleScreen.style.display = 'none';
  hud.style.display = 'block';
  if (isMobile){
    mobileControls.style.display = 'block';
  }
  gameStarted = true;
  checkOrientation();

  if (isMobile) requestFullscreenAndLock();

  showCenterMsg(`Defend the ${teamLabel(playerTeam)} banner. Seize theirs.`);
  animate();
}

// kick off render loop reference (animate is called once game starts)
clock = new THREE.Clock();

})();
