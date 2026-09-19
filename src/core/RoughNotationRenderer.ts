import { MarkdownRenderChild } from "obsidian";
import { annotate } from "rough-notation";
import { normalizeNotationType } from "../models/notations";

type RoughAnnotation = ReturnType<typeof annotate>;
type RoughAnnotationConfig = Parameters<typeof annotate>[1];

const TARGET_CLASS = "fp-rough-notation-target";
const TRANSPARENT_COLORS = new Set(["transparent", "rgba(0, 0, 0, 0)", "rgba(0,0,0,0)"]);
const MAX_ATTACHMENT_FRAMES = 5;

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

export function createRoughNotationConfig(element: HTMLElement): RoughAnnotationConfig {
    return {
        type: normalizeNotationType(element.dataset.fpNotation),
        color: resolveNotationColor(element),
        animate: false,
        multiline: true,
    };
}

export class RoughNotationRenderer extends MarkdownRenderChild {
    private readonly annotateElement: AnnotateElement;
    private readonly annotations = new Map<HTMLElement, RoughAnnotation>();
    private animationFrame: number | null = null;
    private attachmentFrames = 0;
    private disposed = false;

    constructor(containerEl: HTMLElement, annotateElement: AnnotateElement = annotate) {
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
        const targets = Array.from(this.containerEl.querySelectorAll<HTMLElement>("mark"));

        if (this.containerEl.matches("mark")) {
            targets.unshift(this.containerEl);
        }

        for (const target of targets) {
            if (target.hasClass(TARGET_CLASS) || !target.textContent?.trim()) continue;

            const config = createRoughNotationConfig(target);
            const annotation = this.annotateElement(target, config);

            target.addClass(TARGET_CLASS);
            this.annotations.set(target, annotation);
            annotation.show();
        }
    }

    onunload(): void {
        this.disposed = true;

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
    }
}
