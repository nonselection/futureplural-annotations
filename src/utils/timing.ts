/** Opt-in diagnostics for the reading-view highlight path. No selected text is logged. */
const STORAGE_KEY = "fp:timing";

export interface TimingTrace {
    id: number;
    filePath: string;
    started: number;
    previous: number;
    writeStarted: boolean;
    renderReported: boolean;
}

let nextId = 0;
let pendingTrace: TimingTrace | null = null;
let selectionStarted: number | null = null;

function enabled(): boolean {
    try {
        return window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
        return false;
    }
}

function log(trace: TimingTrace, stage: string): void {
    const now = performance.now();
    window.console.info(
        `[FP timing #${trace.id}] ${stage}: +${(now - trace.started).toFixed(1)} ms total, ` +
            `${(now - trace.previous).toFixed(1)} ms since previous`
    );
    trace.previous = now;
}

export function selectionEvent(): void {
    if (!enabled()) return;
    const selection = window.getSelection();
    if (selection?.isCollapsed || !selection?.toString().trim()) return;
    selectionStarted = performance.now();
}

export function toolbarShown(): void {
    if (selectionStarted === null || !enabled()) return;
    const elapsed = performance.now() - selectionStarted;
    selectionStarted = null;
    window.console.info(`[FP timing] selection event → toolbar shown: ${elapsed.toFixed(1)} ms`);
}

export function beginHighlightTiming(filePath: string, action: string): TimingTrace | null {
    if (!enabled()) return null;
    const now = performance.now();
    const trace: TimingTrace = {
        id: ++nextId,
        filePath,
        started: now,
        previous: now,
        writeStarted: false,
        renderReported: false,
    };
    pendingTrace = trace;
    window.console.info(`[FP timing #${trace.id}] ${action} started`);
    return trace;
}

export function timingStep(trace: TimingTrace | null, stage: string): void {
    if (trace) log(trace, stage);
}

export function timingWriteStarted(trace: TimingTrace | null): void {
    if (!trace) return;
    trace.writeStarted = true;
    log(trace, "source prepared; vault.modify started");
}

export function timingRenderingShown(sourcePath: string): void {
    const trace = pendingTrace;
    if (!trace || !trace.writeStarted || trace.renderReported || trace.filePath !== sourcePath) return;
    trace.renderReported = true;
    log(trace, "Rough Notation SVGs shown (before paint)");
    window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
            if (pendingTrace !== trace) return;
            log(trace, "after next paint opportunity");
            pendingTrace = null;
        });
    });
}
