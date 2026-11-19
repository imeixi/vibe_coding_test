/**
 * SnakeAgent — 贪吃蛇启发式安全寻路 Agent
 *
 * 三层决策架构：
 *  1. eat（安全吃果）：BFS 寻找最短吃果路径 + 虚拟蛇模拟吃完后是否仍能追到尾巴
 *  2. tail（追尾保命）：吃果不安全时，选择仍能追到尾巴且能拉长空间/远离死角的步子
 *  3. survive（空间逃生）：连尾巴暂时都不可达时，Flood Fill 选择连通空地最大的方向拖延时间
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SnakeAgent = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const DIRS = [
    { name: 'up',    x: 0,  y: -1 },
    { name: 'down',  x: 0,  y: 1  },
    { name: 'left',  x: -1, y: 0  },
    { name: 'right', x: 1,  y: 0  }
  ];

  function toDirName(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (dx === 1 && dy === 0) return 'right';
    if (dx === -1 && dy === 0) return 'left';
    if (dx === 0 && dy === 1) return 'down';
    if (dx === 0 && dy === -1) return 'up';
    return null;
  }

  function manhattan(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  /**
   * 将蛇身标记到一维阻挡表中。
   * 注意：在 index.html 的规则里，只要本步不吃到食物，尾巴会在本步移走，
   * 碰撞检测排除了 snake[snake.length - 1]，因此 excludeTail=true 时尾巴格视为可通过。
   */
  function buildBlocked(snake, cols, rows, excludeTail) {
    const blocked = new Uint8Array(cols * rows);
    const limit = excludeTail ? snake.length - 1 : snake.length;
    for (let i = 0; i < limit; i++) {
      const s = snake[i];
      if (s.x >= 0 && s.x < cols && s.y >= 0 && s.y < rows) {
        blocked[s.y * cols + s.x] = 1;
      }
    }
    return blocked;
  }

  /**
   * 构造更干净的邻居遍历顺序：优先保持当前直行方向，减少无意义的 Z 字拐弯
   */
  function orderedDirs(preferredDir) {
    if (!preferredDir) return DIRS;
    const out = [];
    for (let i = 0; i < DIRS.length; i++) {
      if (DIRS[i].x === preferredDir.x && DIRS[i].y === preferredDir.y) {
        out.push(DIRS[i]);
      }
    }
    for (let i = 0; i < DIRS.length; i++) {
      if (DIRS[i].x !== preferredDir.x || DIRS[i].y !== preferredDir.y) {
        out.push(DIRS[i]);
      }
    }
    return out;
  }

  /**
   * BFS 最短路径搜索（返回不含起点、含终点的路径数组；不可达返回 null）
   */
  function bfsPath(start, goal, cols, rows, blocked, preferredDir) {
    if (start.x === goal.x && start.y === goal.y) return [];

    const total = cols * rows;
    const startIdx = start.y * cols + start.x;
    const goalIdx = goal.y * cols + goal.x;

    const visited = new Uint8Array(total);
    const parent = new Int32Array(total).fill(-1);
    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;

    visited[startIdx] = 1;
    queue[tail++] = startIdx;

    const dirs = orderedDirs(preferredDir);

    while (head < tail) {
      const cur = queue[head++];
      const cx = cur % cols;
      const cy = (cur - cx) / cols;

      for (let i = 0; i < dirs.length; i++) {
        const nx = cx + dirs[i].x;
        const ny = cy + dirs[i].y;
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;

        const nIdx = ny * cols + nx;
        if (visited[nIdx]) continue;
        if (nIdx !== goalIdx && blocked[nIdx]) continue;

        visited[nIdx] = 1;
        parent[nIdx] = cur;

        if (nIdx === goalIdx) {
          const path = [];
          let p = goalIdx;
          while (p !== startIdx) {
            const px = p % cols;
            const py = (p - px) / cols;
            path.push({ x: px, y: py });
            p = parent[p];
          }
          path.reverse();
          return path;
        }
        queue[tail++] = nIdx;
      }
    }

    return null;
  }

  /**
   * 虚拟蛇模拟：沿 path 走完，如果 ateFood=true 则在最后一步增长不退尾
   */
  function simulatePath(snake, path, ateFood) {
    const vSnake = snake.slice();
    for (let i = 0; i < path.length; i++) {
      vSnake.unshift(path[i]);
      const isLast = i === path.length - 1;
      if (!(ateFood && isLast)) {
        vSnake.pop();
      }
    }
    return vSnake;
  }

  /**
   * 校验蛇头能否到达蛇尾（排除蛇尾本身作为障碍）
   */
  function findPathToTail(snake, cols, rows, preferredDir) {
    const head = snake[0];
    const tail = snake[snake.length - 1];
    const blocked = buildBlocked(snake, cols, rows, true);
    return bfsPath(head, tail, cols, rows, blocked, preferredDir);
  }

  /**
   * Flood Fill 计算从 start 出发能连通的空格总数（用于生存逃生与空间评分）
   */
  function floodFillCount(start, cols, rows, blocked) {
    const total = cols * rows;
    const startIdx = start.y * cols + start.x;
    const visited = new Uint8Array(total);
    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;

    visited[startIdx] = 1;
    queue[tail++] = startIdx;
    let count = 0;

    while (head < tail) {
      const cur = queue[head++];
      const cx = cur % cols;
      const cy = (cur - cx) / cols;

      for (let i = 0; i < DIRS.length; i++) {
        const nx = cx + DIRS[i].x;
        const ny = cy + DIRS[i].y;
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
        const nIdx = ny * cols + nx;
        if (visited[nIdx] || blocked[nIdx]) continue;
        visited[nIdx] = 1;
        queue[tail++] = nIdx;
        count++;
      }
    }

    return count;
  }

  /**
   * 计算紧邻的墙或蛇身数量（用于贴边走位加分，减少把棋盘劈成两半的碎空间）
   */
  function adjacencyScore(cell, cols, rows, blocked) {
    let walls = 0;
    for (let i = 0; i < DIRS.length; i++) {
      const nx = cell.x + DIRS[i].x;
      const ny = cell.y + DIRS[i].y;
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows || blocked[ny * cols + nx]) {
        walls++;
      }
    }
    return walls;
  }

  /**
   * 获取当前所有合法的下一步坐标
   */
  function getLegalMoves(snake, cols, rows, dir) {
    const head = snake[0];
    const blocked = buildBlocked(snake, cols, rows, true);
    const moves = [];
    const dirs = orderedDirs(dir);

    for (let i = 0; i < dirs.length; i++) {
      const d = dirs[i];
      // 不能直接反向（与游戏规则保持一致）
      if (dir && d.x === -dir.x && d.y === -dir.y) continue;
      const nx = head.x + d.x;
      const ny = head.y + d.y;
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
      if (blocked[ny * cols + nx]) continue;
      moves.push({ x: nx, y: ny, dirName: d.name, dirVec: { x: d.x, y: d.y } });
    }
    return moves;
  }

  /**
   * 评估一条吃果路径的安全性（虚拟蛇吃完后能否通关，或仍能追到尾巴且保留健康空间）
   */
  function isSafeEatPath(snake, path, cols, rows) {
    const vSnake = simulatePath(snake, path, true);
    if (vSnake.length >= cols * rows) {
      return { safe: true, vSnake };
    }
    const lastStep = path[path.length - 1];
    const prevStep = path.length >= 2 ? path[path.length - 2] : snake[0];
    const endDir = { x: lastStep.x - prevStep.x, y: lastStep.y - prevStep.y };
    const tailPath = findPathToTail(vSnake, cols, rows, endDir);
    if (!tailPath) {
      return { safe: false, vSnake };
    }
    // 吃完果子后蛇头与蛇尾如果只差 1 格且周围无其他出路，只要蛇长 >= 3 且规则允许进尾格仍是安全闭环
    return { safe: true, vSnake, tailDist: tailPath.length };
  }

  /**
   * 创建可复用、带轻量防死循环状态的 Agent 实例
   */
  function createAgent() {
    let lastLength = 0;
    let stepsSinceEat = 0;
    let stepCounter = 0;
    let lastVisit = null;

    function reset() {
      lastLength = 0;
      stepsSinceEat = 0;
      stepCounter = 0;
      lastVisit = null;
    }

    function decide(state) {
      const { cols, rows, snake, food, dir } = state;
      if (!snake || snake.length === 0) {
        return { dir: null, mode: 'none', path: [] };
      }

      const totalCells = cols * rows;
      if (!lastVisit || lastVisit.length !== totalCells) {
        lastVisit = new Int32Array(totalCells);
      }

      stepCounter++;
      lastVisit[snake[0].y * cols + snake[0].x] = stepCounter;

      if (snake.length !== lastLength) {
        lastLength = snake.length;
        stepsSinceEat = 0;
      } else {
        stepsSinceEat++;
      }

      const head = snake[0];
      const legalMoves = getLegalMoves(snake, cols, rows, dir);
      if (legalMoves.length === 0) {
        return { dir: null, mode: 'none', path: [] };
      }

      // ================================================================
      // 第一层：安全吃果（BFS 最短路 + 虚拟蛇追尾校验）
      // ================================================================
      if (food) {
        const blocked = buildBlocked(snake, cols, rows, true);
        const directPath = bfsPath(head, food, cols, rows, blocked, dir);

        if (directPath && directPath.length > 0) {
          const check = isSafeEatPath(snake, directPath, cols, rows);
          if (check.safe) {
            return {
              dir: toDirName(head, directPath[0]),
              mode: 'eat',
              path: directPath
            };
          }
        }

        // 若默认最短路会导致死胡同，尝试从每个合法邻居出发寻找安全吃果路径
        const sortedMoves = legalMoves
          .slice()
          .sort((a, b) => manhattan(a, food) - manhattan(b, food));

        let bestAltPath = null;
        for (let i = 0; i < sortedMoves.length; i++) {
          const m = sortedMoves[i];
          if (m.x === food.x && m.y === food.y) {
            const p = [{ x: m.x, y: m.y }];
            if (isSafeEatPath(snake, p, cols, rows).safe) {
              bestAltPath = p;
              break;
            }
            continue;
          }
          const nextSnake = simulatePath(snake, [{ x: m.x, y: m.y }], false);
          const nextBlocked = buildBlocked(nextSnake, cols, rows, true);
          const restPath = bfsPath(m, food, cols, rows, nextBlocked, m.dirVec);
          if (!restPath) continue;

          const fullPath = [{ x: m.x, y: m.y }].concat(restPath);
          if (bestAltPath && fullPath.length >= bestAltPath.length) continue;

          if (isSafeEatPath(snake, fullPath, cols, rows).safe) {
            bestAltPath = fullPath;
          }
        }

        if (bestAltPath) {
          return {
            dir: toDirName(head, bestAltPath[0]),
            mode: 'eat',
            path: bestAltPath
          };
        }
      }

      // ================================================================
      // 第二层：追尾保命（拉长到尾巴的距离，避免蜷缩死循环）
      // ================================================================
      const isStalling = stepsSinceEat > Math.max(60, snake.length + 20);

      let bestTailCandidate = null;

      for (let i = 0; i < legalMoves.length; i++) {
        const m = legalMoves[i];
        const ate = food && m.x === food.x && m.y === food.y;
        // 如果这一步直接吃果但前面已验证不安全，则不把它算进常规追尾候选
        if (ate) continue;

        const nextSnake = simulatePath(snake, [{ x: m.x, y: m.y }], false);
        const tailPath = findPathToTail(nextSnake, cols, rows, m.dirVec);
        if (!tailPath) continue;

        const nextBlocked = buildBlocked(nextSnake, cols, rows, true);
        const space = floodFillCount(m, cols, rows, nextBlocked);
        const adj = adjacencyScore(m, cols, rows, nextBlocked);
        const distToFood = food ? manhattan(m, food) : 0;
        const tailDist = tailPath.length;

        let score;
        if (isStalling) {
          // 长时间未吃到食物时，在所有“尾巴可达”的安全步中优先走向最久没走过的格子，
          // 强行改变盘绕轨迹，同时保持一定空间健康度
          const age = stepCounter - lastVisit[m.y * cols + m.x];
          score = age * 10 + space * 2 - distToFood * 2;
        } else {
          // 常规追尾：优先保大连通空地 + 拉长到尾距离，轻微鼓励贴边整理队形
          score = space * 10 + tailDist * 4 + adj * 0.5;
          if (snake.length < totalCells * 0.5) {
            score += distToFood * 0.4;
          }
        }

        if (!bestTailCandidate || score > bestTailCandidate.score) {
          bestTailCandidate = {
            move: m,
            score,
            path: [{ x: m.x, y: m.y }].concat(tailPath)
          };
        }
      }

      if (bestTailCandidate) {
        return {
          dir: bestTailCandidate.move.dirName,
          mode: 'tail',
          path: bestTailCandidate.path
        };
      }

      // ================================================================
      // 第三层：紧急空间逃生（连尾巴都暂时不可达，选连通空地最大的方向）
      // ================================================================
      let bestSurvive = null;
      const tailCell = snake[snake.length - 1];

      for (let i = 0; i < legalMoves.length; i++) {
        const m = legalMoves[i];
        const ate = !!(food && m.x === food.x && m.y === food.y);
        const nextSnake = simulatePath(snake, [{ x: m.x, y: m.y }], ate);
        const nextBlocked = buildBlocked(nextSnake, cols, rows, true);
        const space = floodFillCount(m, cols, rows, nextBlocked);
        const distToTail = manhattan(m, tailCell);
        const score = space * 100 - distToTail;

        if (!bestSurvive || score > bestSurvive.score) {
          bestSurvive = { move: m, score };
        }
      }

      return {
        dir: bestSurvive.move.dirName,
        mode: 'survive',
        path: [{ x: bestSurvive.move.x, y: bestSurvive.move.y }]
      };
    }

    return { decide, reset };
  }

  return {
    createAgent,
    // 导出工具函数方便测试与二次扩展
    _internals: { bfsPath, simulatePath, findPathToTail, floodFillCount }
  };
});
