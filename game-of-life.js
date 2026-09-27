/*
  Conway's Game of Life for Bloxd.io
  Paste this whole file into World Code (press F8 in your own world).

  Chat commands:
    /life here       build a new board where you are standing
    /life view       teleport onto a glass platform high above the board
    /life show       a showcase: glider gun, oscillators and spaceships
    /life acorn      7 cells that explode into thousands of generations
    /life rpent      the R-pentomino, 5 cells of chaos
    /life write TEXT write letters in cells, then watch them come alive
    /life glider     add a glider
    /life gun        add a Gosper glider gun (makes gliders forever)
    /life random     fill the board randomly
    /life go         start the simulation
    /life stop       pause
    /life step       advance one generation
    /life clear      kill every cell
    /life speed N    ticks per generation (1 = fastest, 20 = once a second)
    /life remove     delete the board and put the grass back
    /life wipe       flatten everything near you back to plain grass

  While paused you can place any block on the board to draw live cells,
  or break one to kill it. Then type /life go.
  New cells are yellow, cells that survive turn green.
*/

const SIZE = 64
const FLOOR_BLOCK = "Black Concrete"
const NEW_BLOCK = "Yellow Concrete"
const OLD_BLOCK = "Lime Concrete"
const VIEW_HEIGHT = 55
const WIPE_RADIUS = 80
const WIPE_TOP = 60

/*
  The script forgets everything when you press Submit Code, so the board
  position is saved in the world's database and the cells are read back
  from the blocks.
*/
const ORIGIN_KEY = "lifeOrigin"

let origin = null
let originLoaded = false
let grid = null
let running = false
let ticksPerGen = 3
let tickCount = 0
let generation = 0
let job = null
let wipeConfirm = null

function say(msg) {
  api.broadcastMessage(msg, { color: "lime" })
}

/* ---------- saving the board position ---------- */

function saveOrigin() {
  try {
    if (origin) api.setLobbyDbValue(ORIGIN_KEY, origin.join(","))
    else api.deleteLobbyDbValue(ORIGIN_KEY)
  } catch (e) {
    api.log("Could not save board position", e)
  }
}

function ensureOrigin() {
  if (origin || originLoaded) return
  originLoaded = true
  try {
    const v = api.getLobbyDbValue(ORIGIN_KEY)
    if (typeof v === "string") {
      const p = v.split(",").map(Number)
      if (p.length === 3 && p.every(n => !isNaN(n))) origin = p
    }
  } catch (e) {
    api.log("Could not load board position", e)
  }
}

/*
  ---------- big block jobs ----------
  Building or wiping touches thousands of blocks, which can go over the
  time budget, so the work is done a column at a time and picks up again
  on the next tick.
*/

function startJob(x0, x1, z0, z1, eachColumn, done) {
  job = { x0: x0, x1: x1, z0: z0, z1: z1, x: x0, z: z0, eachColumn: eachColumn, done: done }
  runJob()
}

function runJob() {
  while (job.x <= job.x1) {
    if (api.isNearInterrupt()) return
    job.eachColumn(job.x, job.z)
    job.z++
    if (job.z > job.z1) {
      job.z = job.z0
      job.x++
    }
  }
  const done = job.done
  job = null
  if (done) done()
}

/* ---------- the grid: 0 = dead, 1 = newborn, 2 = older ---------- */

function emptyGrid() {
  const g = []
  for (let i = 0; i < SIZE; i++) {
    g.push(new Array(SIZE).fill(0))
  }
  return g
}

function loadGrid() {
  grid = emptyGrid()
  for (let i = 0; i < SIZE; i++) {
    for (let j = 0; j < SIZE; j++) {
      grid[i][j] = api.getBlock(origin[0] + i, origin[1], origin[2] + j) !== "Air" ? 2 : 0
    }
  }
}

function inBoard(x, y, z) {
  if (!origin) return false
  return y === origin[1] && x >= origin[0] && x < origin[0] + SIZE && z >= origin[2] && z < origin[2] + SIZE
}

function drawCell(i, j, state) {
  const block = state === 0 ? "Air" : state === 1 ? NEW_BLOCK : OLD_BLOCK
  api.setBlock(origin[0] + i, origin[1], origin[2] + j, block)
}

function setCell(i, j, alive) {
  i = ((i % SIZE) + SIZE) % SIZE
  j = ((j % SIZE) + SIZE) % SIZE
  const want = alive ? 2 : 0
  if (grid[i][j] !== want) {
    grid[i][j] = want
    drawCell(i, j, want)
  }
}

function clearCells() {
  for (let i = 0; i < SIZE; i++) {
    for (let j = 0; j < SIZE; j++) setCell(i, j, false)
  }
  generation = 0
}

function step() {
  const next = emptyGrid()
  for (let i = 0; i < SIZE; i++) {
    const left = grid[(i + SIZE - 1) % SIZE]
    const mid = grid[i]
    const right = grid[(i + 1) % SIZE]
    for (let j = 0; j < SIZE; j++) {
      const up = (j + SIZE - 1) % SIZE
      const down = (j + 1) % SIZE
      const n = (left[up] > 0) + (left[j] > 0) + (left[down] > 0) +
        (mid[up] > 0) + (mid[down] > 0) +
        (right[up] > 0) + (right[j] > 0) + (right[down] > 0)
      if (mid[j] > 0) next[i][j] = n === 2 || n === 3 ? 2 : 0
      else next[i][j] = n === 3 ? 1 : 0
    }
  }
  for (let i = 0; i < SIZE; i++) {
    for (let j = 0; j < SIZE; j++) {
      if (next[i][j] !== grid[i][j]) drawCell(i, j, next[i][j])
    }
  }
  grid = next
  generation++
}

/* ---------- building, viewing, removing ---------- */

function buildBoard(playerId) {
  const pos = api.getPosition(playerId)
  const px = Math.floor(pos[0])
  const py = Math.floor(pos[1])
  const pz = Math.floor(pos[2])
  origin = [px - SIZE / 2, py, pz + 3]
  saveOrigin()
  grid = emptyGrid()
  running = false
  generation = 0
  const o = origin
  startJob(o[0] - 1, o[0] + SIZE, o[2] - 1, o[2] + SIZE, (x, z) => {
    api.setBlock(x, o[1] - 1, z, FLOOR_BLOCK)
    for (let y = o[1]; y <= o[1] + 3; y++) api.setBlock(x, y, z, "Air")
  }, () => say("Board built! Try /life show then /life go, and /life view to watch from above"))
}

function platformCenter() {
  return [origin[0] + SIZE / 2, origin[1] + VIEW_HEIGHT, origin[2] + SIZE / 2]
}

function viewFromAbove(playerId) {
  const c = platformCenter()
  for (let x = c[0] - 2; x <= c[0] + 2; x++) {
    for (let z = c[2] - 2; z <= c[2] + 2; z++) {
      api.setBlock(x, c[1], z, "Glass")
    }
  }
  api.setPosition(playerId, c[0] + 0.5, c[1] + 1, c[2] + 0.5)
}

function removeBoard() {
  running = false
  const o = origin
  const c = platformCenter()
  origin = null
  grid = null
  saveOrigin()
  startJob(o[0] - 1, o[0] + SIZE, o[2] - 1, o[2] + SIZE, (x, z) => {
    api.setBlock(x, o[1] - 1, z, "Grass Block")
    api.setBlock(x, o[1], z, "Air")
    if (Math.abs(x - c[0]) <= 2 && Math.abs(z - c[2]) <= 2) api.setBlock(x, c[1], z, "Air")
  }, () => say("Board removed"))
}

function startWipe(playerId) {
  const pos = api.getPosition(playerId)
  const cx = Math.floor(pos[0])
  const cz = Math.floor(pos[2])
  running = false
  origin = null
  grid = null
  saveOrigin()
  say("Wiping... this can take a little while")
  startJob(cx - WIPE_RADIUS, cx + WIPE_RADIUS, cz - WIPE_RADIUS, cz + WIPE_RADIUS, (x, z) => {
    for (let y = 1; y <= WIPE_TOP; y++) {
      if (api.getBlock(x, y, z) !== "Air") api.setBlock(x, y, z, "Air")
    }
    if (api.getBlock(x, 0, z) !== "Grass Block") api.setBlock(x, 0, z, "Grass Block")
  }, () => say("Wipe done! Type /life here to build a new board"))
}

/*
  ---------- patterns ----------
  Written in RLE, the standard Game of Life pattern format:
  b = dead, o = alive, $ = next row, a number repeats what follows.
*/

function rle(str) {
  const cells = []
  let x = 0
  let y = 0
  let count = ""
  for (const ch of str) {
    if (ch >= "0" && ch <= "9") {
      count += ch
      continue
    }
    const n = count === "" ? 1 : parseInt(count)
    count = ""
    if (ch === "b") x += n
    else if (ch === "o") {
      for (let k = 0; k < n; k++) cells.push([x + k, y])
      x += n
    }
    else if (ch === "$") {
      y += n
      x = 0
    }
    else if (ch === "!") break
  }
  return cells
}

const PATTERNS = {
  glider: rle("bo$2bo$3o!"),
  gun: rle("24bo$22bobo$12b2o6b2o12b2o$11bo3bo4b2o12b2o$2o8bo5bo3b2o$2o8bo3bob2o4bobo$10bo5bo7bo$11bo3bo$12b2o!"),
  acorn: rle("bo$3bo$2o2b3o!"),
  rpent: rle("b2o$2o$bo!"),
  pulsar: rle("2b3o3b3o2$o4bobo4bo$o4bobo4bo$o4bobo4bo$2b3o3b3o2$2b3o3b3o$o4bobo4bo$o4bobo4bo$o4bobo4bo2$2b3o3b3o!"),
  penta: rle("2bo4bo$2ob4ob2o$2bo4bo!"),
  lwss: rle("bo2bo$o4b$o3bo$4o!"),
  eater: rle("2o$obo$2bo$2b2o!")
}

function stampAt(cells, i0, j0) {
  for (const c of cells) setCell(i0 + c[0], j0 + c[1], true)
}

function stampCentered(cells) {
  let w = 0
  let h = 0
  for (const c of cells) {
    w = Math.max(w, c[0] + 1)
    h = Math.max(h, c[1] + 1)
  }
  stampAt(cells, Math.floor((SIZE - w) / 2), Math.floor((SIZE - h) / 2))
}

function showcase() {
  clearCells()
  stampAt(PATTERNS.gun, 2, 2)
  stampAt(PATTERNS.eater, 48, 34)
  stampAt(PATTERNS.pulsar, 46, 4)
  stampAt(PATTERNS.penta, 6, 24)
  stampAt(PATTERNS.lwss, 20, 48)
  stampAt(PATTERNS.lwss, 40, 48)
  stampAt(PATTERNS.lwss, 60, 48)
}

/* 3 wide, 5 tall letters, rows top to bottom */
const FONT = {
  A: [".#.", "#.#", "###", "#.#", "#.#"], B: ["##.", "#.#", "##.", "#.#", "##."],
  C: [".##", "#..", "#..", "#..", ".##"], D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"], F: ["###", "#..", "##.", "#..", "#.."],
  G: [".##", "#..", "#.#", "#.#", ".##"], H: ["#.#", "#.#", "###", "#.#", "#.#"],
  I: ["###", ".#.", ".#.", ".#.", "###"], J: ["..#", "..#", "..#", "#.#", ".#."],
  K: ["#.#", "#.#", "##.", "#.#", "#.#"], L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#.#", "###", "###", "#.#", "#.#"], N: ["##.", "#.#", "#.#", "#.#", "#.#"],
  O: [".#.", "#.#", "#.#", "#.#", ".#."], P: ["##.", "#.#", "##.", "#..", "#.."],
  Q: [".#.", "#.#", "#.#", "##.", ".##"], R: ["##.", "#.#", "##.", "#.#", "#.#"],
  S: [".##", "#..", ".#.", "..#", "##."], T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", "###"], V: ["#.#", "#.#", "#.#", "#.#", ".#."],
  W: ["#.#", "#.#", "###", "###", "#.#"], X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."], Z: ["###", "..#", ".#.", "#..", "###"]
}

function writeText(text) {
  const words = text.toUpperCase().split(/\s+/).filter(w => w.length > 0)
  const perLine = Math.floor((SIZE - 2) / 4)
  const lines = []
  let line = ""
  for (const w of words) {
    const tryLine = line === "" ? w : line + " " + w
    if (tryLine.length <= perLine) line = tryLine
    else {
      if (line !== "") lines.push(line)
      line = w.slice(0, perLine)
    }
  }
  if (line !== "") lines.push(line)
  clearCells()
  const top = Math.floor((SIZE - lines.length * 7) / 2)
  lines.forEach((ln, row) => {
    const left = Math.floor((SIZE - (ln.length * 4 - 1)) / 2)
    for (let k = 0; k < ln.length; k++) {
      const glyph = FONT[ln[k]]
      if (!glyph) continue
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 3; c++) {
          if (glyph[r][c] === "#") setCell(left + k * 4 + c, top + row * 7 + r, true)
        }
      }
    }
  })
}

/* ---------- callbacks ---------- */

playerCommand = (playerId, command) => {
  const parts = (command[0] === "/" ? command.slice(1) : command).trim().split(/\s+/)
  if (parts[0] !== "life") return false
  const sub = parts[1] || ""

  if (job) {
    say("Still working on the last command, hang on")
    return true
  }

  if (sub === "wipe") {
    if (parts[2] === "yes" && wipeConfirm === playerId) {
      wipeConfirm = null
      startWipe(playerId)
    } else {
      wipeConfirm = playerId
      say("This deletes EVERYTHING within " + WIPE_RADIUS + " blocks of you. Type /life wipe yes to do it")
    }
    return true
  }

  ensureOrigin()
  if (sub === "here") {
    buildBoard(playerId)
    return true
  }
  if (!origin) {
    say("Type /life here first to build a board")
    return true
  }
  if (!grid) loadGrid()

  if (sub === "show") showcase()
  else if (sub === "write") writeText(parts.slice(2).join(" "))
  else if (PATTERNS[sub]) stampCentered(PATTERNS[sub])
  else if (sub === "random") {
    for (let i = 0; i < SIZE; i++) {
      for (let j = 0; j < SIZE; j++) setCell(i, j, Math.random() < 0.3)
    }
  }
  else if (sub === "clear") clearCells()
  else if (sub === "go") { running = true; say("Running!") }
  else if (sub === "stop") { running = false; say("Paused at generation " + generation) }
  else if (sub === "step") step()
  else if (sub === "view") viewFromAbove(playerId)
  else if (sub === "remove") removeBoard()
  else if (sub === "speed") {
    ticksPerGen = Math.max(1, parseInt(parts[2]) || 3)
    say("Speed: one generation every " + ticksPerGen + " ticks")
  }
  else say("Commands: here, view, show, acorn, rpent, write, glider, gun, random, go, stop, step, clear, speed N, remove, wipe")
  return true
}

onPlayerChangeBlock = (playerId, x, y, z, fromBlock, toBlock) => {
  if (inBoard(x, y, z)) {
    if (grid) grid[x - origin[0]][z - origin[2]] = toBlock !== "Air" ? 2 : 0
    return "preventDrop"
  }
}

tick = () => {
  if (job) {
    runJob()
    return
  }
  if (!running || !origin || !grid) return
  tickCount++
  if (tickCount >= ticksPerGen) {
    tickCount = 0
    step()
  }
}
