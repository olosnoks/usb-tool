/**
 * Recipe.js
 * Advanced CyberChef Recipe pipeline with Flow Control (Fork/Merge, Register,
 * Subsection, Label/Jump), Breakpoints, and Step-Through debugging execution.
 */

import { Dish } from './Dish.js';
import registry from './OperationRegistry.js';

export class ExecutionContext {
  constructor(options = {}) {
    this.registers = new Map(); // Name -> string
    this.labels = new Map(); // LabelName -> stepIndex
    this.jumpCounts = new Map(); // StepIndex -> count
    this.forkStack = []; // Stack of { branches: Dish[], mergeDelimiter: string }
    this.subsectionStack = []; // Stack of { regex: RegExp, invert: boolean }
    this.history = []; // Step history [{ stepIndex, opName, dish, durationMs }]
    this.breakpoints = new Set(options.breakpoints || []);
    this.maxSteps = typeof options.maxSteps === 'number' ? options.maxSteps : Infinity;
    this.startStep = typeof options.startStep === 'number' ? options.startStep : 0;
  }
}

export class Recipe {
  /**
   * @param {Array<Object>} steps - Array of { op|id|name: string, args: Object|Array, disabled?: boolean, breakpoint?: boolean, uniqueId?: string }
   */
  constructor(steps = []) {
    this.steps = Array.isArray(steps) ? steps : [];
  }

  /**
   * Normalizes argument array or object into an argument object
   * based on the operation's declared argument schema.
   * @param {Operation} op
   * @param {Object|Array} args
   * @returns {Object}
   */
  normalizeArgs(op, args) {
    const res = {};
    const schema = op.args || [];

    for (const def of schema) {
      if (def.default !== undefined) {
        res[def.name] = def.default;
      }
    }

    if (Array.isArray(args)) {
      args.forEach((val, idx) => {
        if (schema[idx]) {
          res[schema[idx].name] = val;
        }
      });
    } else if (args && typeof args === 'object') {
      Object.assign(res, args);
    }

    return res;
  }

  /**
   * Scans recipe to index all Label steps ahead of time.
   * @param {ExecutionContext} context
   */
  indexLabels(context) {
    context.labels.clear();
    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];
      if (!step || step.disabled) continue;
      const opIdentifier = (step.op || step.name || step.id || '').toLowerCase();
      if (opIdentifier === 'label') {
        const labelName = step.args?.name || step.args?.[0] || `label_${i}`;
        context.labels.set(String(labelName).trim().toLowerCase(), i);
      }
    }
  }

  /**
   * Execute the recipe against an initial Dish.
   * @param {Dish|string|ArrayBuffer} input
   * @param {Object} [options={}] - { breakpoints: Array<number|string>, maxSteps?: number, startStep?: number, context?: ExecutionContext }
   * @returns {Promise<Dish>}
   */
  async execute(input, options = {}) {
    let currentDish = input instanceof Dish ? input : new Dish(input);
    const context = options.context || new ExecutionContext(options);

    this.indexLabels(context);

    // Merge any breakpoint flags defined directly on steps
    for (let idx = 0; idx < this.steps.length; idx++) {
      const step = this.steps[idx];
      if (step?.breakpoint) {
        context.breakpoints.add(idx);
        if (step.uniqueId) context.breakpoints.add(step.uniqueId);
      }
    }

    let executedCount = 0;
    let i = context.startStep;

    while (i < this.steps.length) {
      const step = this.steps[i];
      if (!step || step.disabled) {
        i++;
        continue;
      }

      const opIdentifier = step.op || step.name || step.id;
      const op = registry.get(opIdentifier);

      if (!op) {
        throw new Error(`Unknown operation in recipe: "${opIdentifier}" at step ${i + 1}`);
      }

      // Check Breakpoint pause condition (before running step)
      const isBreakpoint =
        context.breakpoints.has(i) ||
        (step.uniqueId && context.breakpoints.has(step.uniqueId));

      if (isBreakpoint && executedCount > 0) {
        currentDish.paused = true;
        currentDish.pausedStepIndex = i;
        currentDish.pausedStepOp = op.name;
        currentDish.history = context.history;
        currentDish.context = context;
        return currentDish;
      }

      if (executedCount >= context.maxSteps) {
        currentDish.paused = true;
        currentDish.pausedStepIndex = i;
        currentDish.pausedStepOp = op.name;
        currentDish.history = context.history;
        currentDish.context = context;
        return currentDish;
      }

      const args = this.normalizeArgs(op, step.args);
      const opKey = (op.id || op.name).toLowerCase();
      const stepStartTime = performance.now();

      // ======================================================================
      // FLOW CONTROL HANDLERS
      // ======================================================================

      // 1. Fork
      if (opKey === 'fork') {
        const splitDelim = args.splitDelimiter !== undefined ? args.splitDelimiter : (args.delimiter !== undefined ? args.delimiter : '\n');
        const mergeDelim = args.mergeDelimiter !== undefined ? args.mergeDelimiter : '\n';

        const rawText = context.forkStack.length > 0
          ? context.forkStack[context.forkStack.length - 1].branches.map(d => d.toString()).join(mergeDelim)
          : currentDish.toString();

        const parts = rawText.split(splitDelim === '' ? '' : (splitDelim === '\\n' ? '\n' : splitDelim));
        const branches = parts.map(part => new Dish(part, 'string'));

        context.forkStack.push({
          branches,
          mergeDelimiter: mergeDelim === '\\n' ? '\n' : mergeDelim
        });
        i++;
        executedCount++;
        continue;
      }

      // 2. Merge
      if (opKey === 'merge') {
        const customMergeDelim = args.delimiter !== undefined ? args.delimiter : '\n';
        const actualDelim = customMergeDelim === '\\n' ? '\n' : customMergeDelim;

        if (context.forkStack.length > 0) {
          const topFork = context.forkStack.pop();
          const mergedText = topFork.branches.map(d => d.toString()).join(actualDelim);
          currentDish = new Dish(mergedText, 'string');
        } else {
          const lines = currentDish.toString().split(/\r?\n/);
          currentDish = new Dish(lines.join(actualDelim), 'string');
        }
        i++;
        executedCount++;
        continue;
      }

      // 3. Register (Memory Storage & Substitution)
      if (opKey === 'register') {
        const regName = (args.register || 'R0').trim();
        const mode = args.mode || 'Set';
        const pattern = args.pattern || '';

        if (mode === 'Set') {
          const text = currentDish.toString();
          let valToStore = text;
          if (pattern && pattern.trim()) {
            try {
              const regex = new RegExp(pattern);
              const match = text.match(regex);
              if (match) {
                valToStore = match[1] !== undefined ? match[1] : match[0];
              }
            } catch (err) {
              console.warn(`Register regex error for pattern "${pattern}":`, err);
            }
          }
          context.registers.set(regName, valToStore);
        } else if (mode === 'Get') {
          const stored = context.registers.get(regName) || '';
          currentDish = new Dish(stored, 'string');
        } else if (mode === 'Inject / Replace') {
          let text = currentDish.toString();
          for (const [key, val] of context.registers.entries()) {
            const tokenRegex = new RegExp(`\\$${key}|\\$\\{${key}\\}`, 'g');
            text = text.replace(tokenRegex, val);
          }
          currentDish = new Dish(text, 'string');
        }
        i++;
        executedCount++;
        continue;
      }

      // 4. Subsection
      if (opKey === 'subsection') {
        const action = args.action || 'Start';
        if (action === 'Start') {
          const pattern = args.regex || '.*';
          const invert = args.invert === 'Yes' || args.invert === true;
          try {
            context.subsectionStack.push({ regex: new RegExp(pattern), invert });
          } catch {
            context.subsectionStack.push({ regex: /.*/, invert: false });
          }
        } else {
          context.subsectionStack.pop();
        }
        i++;
        executedCount++;
        continue;
      }

      // 5. Label
      if (opKey === 'label') {
        i++;
        executedCount++;
        continue;
      }

      // 6. Jump
      if (opKey === 'jump') {
        const targetLabel = String(args.label || '').trim().toLowerCase();
        const maxJumps = Number(args.maxJumps) || 10;
        const condition = args.condition || 'Always';
        const condRegex = args.regex ? new RegExp(args.regex) : null;

        const currentJumps = context.jumpCounts.get(i) || 0;
        let shouldJump = currentJumps < maxJumps;

        if (shouldJump) {
          if (condition === 'If Input Not Empty') {
            shouldJump = currentDish.length > 0 && currentDish.toString().trim().length > 0;
          } else if (condition === 'If Matches Regex' && condRegex) {
            shouldJump = condRegex.test(currentDish.toString());
          }
        }

        if (shouldJump && context.labels.has(targetLabel)) {
          context.jumpCounts.set(i, currentJumps + 1);
          i = context.labels.get(targetLabel);
          executedCount++;
          continue;
        }

        i++;
        executedCount++;
        continue;
      }

      // ======================================================================
      // EXECUTION UNDER FORK / SUBSECTION STACKS
      // ======================================================================

      if (context.forkStack.length > 0) {
        const currentFork = context.forkStack[context.forkStack.length - 1];
        const nextBranches = [];
        for (const branchDish of currentFork.branches) {
          const res = await this.executeUnderSubsection(op, branchDish, args, context);
          nextBranches.push(res);
        }
        currentFork.branches = nextBranches;
      } else {
        currentDish = await this.executeUnderSubsection(op, currentDish, args, context);
      }

      const stepDuration = Math.round((performance.now() - stepStartTime) * 100) / 100;
      context.history.push({
        stepIndex: i,
        opName: op.name,
        outputDish: currentDish.clone(),
        durationMs: stepDuration
      });

      executedCount++;
      i++;
    }

    // Auto-resolve any unclosed fork branches
    while (context.forkStack.length > 0) {
      const topFork = context.forkStack.pop();
      const mergedText = topFork.branches.map(d => d.toString()).join(topFork.mergeDelimiter);
      currentDish = new Dish(mergedText, 'string');
    }

    currentDish.paused = false;
    currentDish.completed = true;
    currentDish.history = context.history;
    currentDish.context = context;
    return currentDish;
  }

  /**
   * Executes an operation honoring any active subsection filters.
   * If a subsection is active, non-matching lines are left unchanged.
   */
  async executeUnderSubsection(op, dish, args, context) {
    if (context.subsectionStack.length === 0) {
      return await op.execute(dish, args);
    }

    const { regex, invert } = context.subsectionStack[context.subsectionStack.length - 1];
    const text = dish.toString();
    const lines = text.split(/\r?\n/);
    const outLines = [];

    for (const line of lines) {
      const isMatch = regex.test(line);
      const shouldApply = invert ? !isMatch : isMatch;

      if (shouldApply) {
        const subDish = new Dish(line, 'string');
        const res = await op.execute(subDish, args);
        outLines.push(res.toString());
      } else {
        outLines.push(line);
      }
    }

    return new Dish(outLines.join('\n'), 'string');
  }
}

export default Recipe;
