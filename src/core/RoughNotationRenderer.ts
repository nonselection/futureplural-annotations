import { MarkdownRenderChild } from "obsidian";
import { annotate } from "rough-notation";
import {
    DEFAULT_NOTATION_OPACITY,
    normalizeOpacity,
    normalizeNotationType,
    type NotationType,
} from "../models/notations";

type RoughAnnotation = ReturnType<typeof annotate>;
type RoughAnnotationConfig = Parameters<typeof annotate>[1];
type Rect = { x: number; y: number; width: number; height: number };

const TARGET_CLASS = "fp-rough-notation-target";
const TRANSPARENT_COLORS = new Set(["transparent", "rgba(0, 0, 0, 0)", "rgba(0,0,0,0)"]);
const MAX_ATTACHMENT_FRAMES = 5;

// Obsidian post-processes a note in sections. Share one layout watcher across
// those children, so a long document does not create an observer per paragraph.
type LayoutSubscriber = (force: boolean) => void;
const layoutWatchers = new WeakMap<HTMLElement, { subscribers: Set<LayoutSubscriber>; stop: () => void }>();

function watchNoteLayout(root: HTMLElement, subscriber: LayoutSubscriber): () => void {
    let watcher = layoutWatchers.get(root);
    if (!watcher) {
        const win = elementWindow(root);
        const observers = win as
            | (Window & {
                  ResizeObserver?: typeof ResizeObserver;
                  MutationObserver?: typeof MutationObserver;
              })
            | null;
        const subscribers = new Set<LayoutSubscriber>();
        let frame: number | null = null;
        let force = false;
        const schedule = (forceRedraw = false) => {
            force ||= forceRedraw;
            if (!win || frame !== null) return;
            frame = win.requestAnimationFrame(() => {
                frame = null;
                const forceNow = force;
                force = false;
                for (const notify of subscribers) notify(forceNow);
            });
        };
        const widths = new WeakMap<Element, number>();
        const resize = observers?.ResizeObserver
            ? new observers.ResizeObserver((entries) => {
                  let widthChanged = false;
                  for (const entry of entries) {
                      const width = entry.target.getBoundingClientRect().width;
                      const previous = widths.get(entry.target);
                      if (previous === undefined || Math.abs(width - previous) > 0.5) widthChanged = true;
                      widths.set(entry.target, width);
                  }
                  schedule(widthChanged);
              })
            : null;
        const observeSize = (element: HTMLElement | null) => {
            if (!element || !resize) return;
            widths.set(element, element.getBoundingClientRect().width);
            resize.observe(element);
        };
        observeSize(root);
        const sizer = root.querySelector<HTMLElement>(".markdown-preview-sizer");
        observeSize(sizer);
        observeSize(root.closest<HTMLElement>(".workspace-leaf"));
        const mutation = observers?.MutationObserver ? new observers.MutationObserver(() => schedule(true)) : null;
        mutation?.observe(root, {
            attributes: true,
            attributeFilter: [
                "class",
                "style",
                "data-has-sidenotes",
                "data-sidenote-position",
                "data-sidenote-page-offset",
                "data-sidenote-has-opposite",
                "data-sidenote-mode",
            ],
        });
        const onScroll = () => schedule();
        root.addEventListener("scroll", onScroll, { passive: true, capture: true });
        watcher = {
            subscribers,
            stop: () => {
                root.removeEventListener("scroll", onScroll, true);
                resize?.disconnect();
                mutation?.disconnect();
                if (frame !== null) win?.cancelAnimationFrame(frame);
            },
        };
        layoutWatchers.set(root, watcher);
    }
    watcher.subscribers.add(subscriber);
    return () => {
        watcher.subscribers.delete(subscriber);
        if (watcher.subscribers.size === 0) {
            watcher.stop();
            layoutWatchers.delete(root);
        }
    };
}

function markRects(target: HTMLElement): Rect[] | null {
    const svg = [target.previousElementSibling, target.nextElementSibling].find((el) =>
        el?.matches("svg.rough-annotation")
    );
    if (!svg) return null;
    const anchor = svg.getBoundingClientRect();
    return Array.from(target.getClientRects(), (rect) => ({
        x: rect.left - anchor.left,
        y: rect.top - anchor.top,
        width: rect.width,
        height: rect.height,
    }));
}

function rectsChanged(previous: Rect[] | null, current: Rect[] | null): boolean {
    if (!previous || !current || previous.length !== current.length) return false;
    return previous.some((rect, index) => {
        const next = current[index];
        return (Object.keys(rect) as (keyof Rect)[]).some((key) => Math.abs(rect[key] - next[key]) > 0.5);
    });
}

export type AnnotateElement = (element: HTMLElement, config: RoughAnnotationConfig) => RoughAnnotation;

function elementWindow(element: HTMLElement): Window | null {
    return element.ownerDocument.defaultView;
}

export function resolveNotationColor(element: HTMLElement): string {
    const explicitColor = element.dataset.fpColor?.trim();
    if (explicitColor) return explicitColor;

    const inlineColor = element.style.backgroundColor.trim();
    if (inlineColor && !TRANSPARENT_COLORS.has(inlineColor)) return inlineColor;

    const win = elementWindow(element);
    const computedColor = win?.getComputedStyle(element).backgroundColor.trim();
    if (computedColor && !TRANSPARENT_COLORS.has(computedColor)) return computedColor;

    return "currentColor";
}

export function colorWithOpacity(color: string, opacity: number): string {
    if (opacity === 1) return color;
    const hex = /^#([\da-f]{6})$/i.exec(color);
    if (hex)
        return `#${hex[1]}${Math.round(opacity * 255)
            .toString(16)
            .padStart(2, "0")}`;
    return `color-mix(in srgb, ${color} ${Math.round(opacity * 100)}%, transparent)`;
}

export function createRoughNotationConfig(
    element: HTMLElement,
    opacityByType: Record<NotationType, number> = DEFAULT_NOTATION_OPACITY
): RoughAnnotationConfig {
    const type = normalizeNotationType(element.dataset.fpNotation);
    const opacity = normalizeOpacity(element.dataset.fpOpacity) ?? opacityByType[type];
    const config: RoughAnnotationConfig = {
        type,
        color: colorWithOpacity(resolveNotationColor(element), opacity),
        animate: false,
        multiline: true,
    };
    if (type === "underline") config.padding = [0, 0, 1, 0];
    if (type === "box" || type === "circle") config.padding = [2, 3, 2, 3];
    return config;
}

/** Keep a mark's shape stable when Obsidian replaces its Markdown paragraph. */
export function notationSeed(element: HTMLElement, sourcePath: string): number {
    const block = element.closest("p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th") ?? element.parentElement;
    const text = element.textContent?.trim() ?? "";
    const type = normalizeNotationType(element.dataset.fpNotation);
    const peers = Array.from(block?.querySelectorAll("mark") ?? []);
    const occurrence = peers.slice(0, peers.indexOf(element)).filter((peer) => {
        return peer.textContent?.trim() === text && normalizeNotationType(peer.dataset.fpNotation) === type;
    }).length;
    const key = `${sourcePath}\0${block?.textContent?.replace(/\s+/g, " ").trim() ?? ""}\0${type}\0${text}\0${occurrence}`;
    let hash = 2166136261;
    for (let i = 0; i < key.length; i++) {
        hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
    }
    return hash & 0x7fffffff || 1;
}

export class RoughNotationRenderer extends MarkdownRenderChild {
    private readonly annotateElement: AnnotateElement;
    private readonly annotations = new Map<HTMLElement, RoughAnnotation>();
    private readonly positions = new Map<HTMLElement, Rect[] | null>();
    private stopLayoutWatch: (() => void) | null = null;
    private animationFrame: number | null = null;
    private attachmentFrames = 0;
    private disposed = false;

    constructor(
        containerEl: HTMLElement,
        annotateElement: AnnotateElement = annotate,
        private readonly onShown?: () => void,
        private readonly sourcePath = "",
        private readonly opacityByType: Record<NotationType, number> = DEFAULT_NOTATION_OPACITY
    ) {
        super(containerEl);
        this.annotateElement = annotateElement;
    }

    onload(): void {
        this.disposed = false;
        this.attachmentFrames = 0;
        this.scheduleRender();
    }

    private scheduleRender(): void {
        const win = elementWindow(this.containerEl);

        if (!win || typeof win.requestAnimationFrame !== "function") {
            if (this.containerEl.isConnected) this.renderTargets();
            return;
        }

        this.animationFrame = win.requestAnimationFrame(() => {
            this.animationFrame = null;
            if (this.disposed) return;

            if (!this.containerEl.isConnected) {
                this.attachmentFrames += 1;
                if (this.attachmentFrames < MAX_ATTACHMENT_FRAMES) this.scheduleRender();
                return;
            }

            this.renderTargets();
        });
    }

    private renderTargets(): void {
        const targets = Array.from(this.containerEl.querySelectorAll<HTMLElement>("mark[data-fp-notation]"));

        if (this.containerEl.matches("mark[data-fp-notation]")) {
            targets.unshift(this.containerEl);
        }

        for (const target of targets) {
            if (target.hasClass(TARGET_CLASS) || !target.textContent?.trim()) continue;

            const config = createRoughNotationConfig(target, this.opacityByType);
            const annotation = this.annotateElement(target, config);

            // Rough Notation 0.5.1 seeds each new instance at random and exposes
            // no public seed option. Its render method uses this internal field.
            // Guard the hook so a future library change retains normal rendering.
            if (Object.prototype.hasOwnProperty.call(annotation, "_seed")) {
                (annotation as RoughAnnotation & { _seed: number })._seed = notationSeed(target, this.sourcePath);
            }

            target.addClass(TARGET_CLASS);
            this.annotations.set(target, annotation);
            annotation.show();
            this.positions.set(target, markRects(target));
            this.onShown?.();
        }

        if (this.annotations.size && !this.stopLayoutWatch) {
            const root =
                this.containerEl.closest<HTMLElement>(".markdown-reading-view") ??
                this.containerEl.closest<HTMLElement>(".markdown-preview-view") ??
                this.containerEl;
            this.stopLayoutWatch = watchNoteLayout(root, (force) => this.refreshMovedMarks(force));
        }
    }

    private refreshMovedMarks(force = false): void {
        if (this.disposed) return;
        for (const [target, annotation] of this.annotations) {
            if (!target.isConnected) continue;
            const current = markRects(target);
            if (force || rectsChanged(this.positions.get(target) ?? null, current)) {
                // show() on an already visible annotation redraws it without
                // animation. The existing seeded instance preserves its shape.
                annotation.show();
                this.positions.set(target, markRects(target));
            }
        }
    }

    onunload(): void {
        this.disposed = true;
        this.stopLayoutWatch?.();
        this.stopLayoutWatch = null;

        const win = elementWindow(this.containerEl);
        if (this.animationFrame !== null && win) {
            win.cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        for (const [target, annotation] of this.annotations) {
            annotation.remove();
            target.removeClass(TARGET_CLASS);
        }
        this.annotations.clear();
        this.positions.clear();
    }
}
