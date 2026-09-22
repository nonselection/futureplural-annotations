import { describe, expect, it, vi } from "vitest";
import { createRoughNotationConfig, notationSeed, RoughNotationRenderer } from "../src/core/RoughNotationRenderer";
import { createObsidianWindow } from "./dom-helpers.js";

function fakeAnnotation() {
    return {
        show: vi.fn(),
        hide: vi.fn(),
        remove: vi.fn(),
        isShowing: vi.fn(() => true),
    };
}

function waitForAnimationFrame(window) {
    return new Promise((resolve) => window.requestAnimationFrame(resolve));
}

describe("Rough Notation renderer", () => {
    it("moves existing marks when sidenote layout changes without replacing their annotation", async () => {
        const window = createObsidianWindow();
        const root = window.document.getElementById("content");
        root.classList.add("markdown-reading-view");
        root.innerHTML =
            '<div class="markdown-preview-view"><p><mark data-fp-notation="box">One</mark></p><p><mark data-fp-notation="underline">Two</mark></p></div>';
        const observers = [];
        window.ResizeObserver = class {
            constructor(callback) {
                this.callback = callback;
                this.observe = vi.fn();
                this.disconnect = vi.fn();
                observers.push(this);
            }
        };
        let x = 10;
        const marks = root.querySelectorAll("mark");
        for (const mark of marks) {
            mark.getClientRects = () => [{ left: x, top: 20, width: 40, height: 20 }];
        }
        const annotations = [];
        const annotateElement = vi.fn((mark) => {
            const svg = window.document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.classList.add("rough-annotation");
            svg.getBoundingClientRect = () => ({ left: 0, top: 0 });
            mark.after(svg);
            const annotation = fakeAnnotation();
            annotation.remove.mockImplementation(() => svg.remove());
            annotations.push(annotation);
            return annotation;
        });
        const children = [...root.querySelectorAll("p")].map(
            (paragraph) => new RoughNotationRenderer(paragraph, annotateElement)
        );
        children.forEach((child) => child.onload());
        await waitForAnimationFrame(window);
        expect(annotations).toHaveLength(2);
        expect(observers).toHaveLength(1);
        expect(observers[0].observe.mock.calls[0][0] === root).toBe(true);

        x = 45;
        root.setAttribute("data-has-sidenotes", "true");
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        await waitForAnimationFrame(window);
        expect(annotations.map((annotation) => annotation.show.mock.calls.length)).toEqual([2, 2]);
        expect(annotateElement).toHaveBeenCalledTimes(2);

        // A scroll without movement leaves every shape alone.
        root.dispatchEvent(new window.Event("scroll"));
        await waitForAnimationFrame(window);
        expect(annotations.map((annotation) => annotation.show.mock.calls.length)).toEqual([2, 2]);
        x = 55;
        observers[0].callback([{ target: root }]);
        await waitForAnimationFrame(window);
        expect(annotations.map((annotation) => annotation.show.mock.calls.length)).toEqual([3, 3]);

        // A pane resize must redraw even when the relative mark rectangles
        // temporarily look unchanged (an old multiline SVG can persist).
        root.getBoundingClientRect = () => ({ width: 350 });
        observers[0].callback([{ target: root }]);
        await waitForAnimationFrame(window);
        expect(annotations.map((annotation) => annotation.show.mock.calls.length)).toEqual([4, 4]);
        children.forEach((child) => child.onunload());
        expect(observers[0].disconnect).toHaveBeenCalledOnce();
        x = 60;
        root.setAttribute("data-has-sidenotes", "false");
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        await waitForAnimationFrame(window);
        expect(annotations.map((annotation) => annotation.show.mock.calls.length)).toEqual([4, 4]);
    });

    it("keeps an existing mark's seed when another mark is added to its paragraph", async () => {
        const window = createObsidianWindow();
        const container = window.document.getElementById("content");
        const seeds = [];
        const annotateElement = vi.fn(() => {
            const annotation = { ...fakeAnnotation(), _seed: 123 };
            annotation.show.mockImplementation(() => seeds.push(annotation._seed));
            return annotation;
        });

        container.innerHTML = '<p>A <mark data-fp-notation="circle">word</mark> and another word.</p>';
        const first = new RoughNotationRenderer(container, annotateElement, undefined, "study.md");
        first.onload();
        await waitForAnimationFrame(window);
        const initialSeed = seeds[0];
        expect(initialSeed).toBeGreaterThan(0);
        first.onunload();

        container.innerHTML =
            '<p>A <mark data-fp-notation="circle">word</mark> and <mark data-fp-notation="box">another</mark> word.</p>';
        const second = new RoughNotationRenderer(container, annotateElement, undefined, "study.md");
        second.onload();
        await waitForAnimationFrame(window);

        expect(seeds[1]).toBe(initialSeed);
        expect(seeds[2]).not.toBe(initialSeed);
        expect(notationSeed(container.querySelector("mark"), "other.md")).not.toBe(initialSeed);
        second.onunload();
    });

    it("maps FuturePlural metadata to a non-animated multiline annotation", () => {
        const window = createObsidianWindow();
        const mark = window.document.createElement("mark");
        mark.dataset.fpNotation = "underline";
        mark.dataset.fpColor = "#8fa58f";

        expect(createRoughNotationConfig(mark)).toEqual({
            type: "underline",
            color: "#8fa58fcc",
            animate: false,
            multiline: true,
            padding: [0, 0, 1, 0],
        });
    });

    it("keeps saved opacity stable while older marks use current gesture settings", () => {
        const window = createObsidianWindow();
        const saved = window.document.createElement("mark");
        saved.dataset.fpNotation = "box";
        saved.dataset.fpColor = "#8fa58f";
        saved.dataset.fpOpacity = "0.45";
        const old = window.document.createElement("mark");
        old.dataset.fpNotation = "box";
        old.dataset.fpColor = "#8fa58f";
        const opacityByType = {
            highlight: 0.6,
            underline: 0.8,
            box: 0.8,
            circle: 0.68,
            "strike-through": 0.76,
            "crossed-off": 0.72,
        };

        expect(createRoughNotationConfig(saved, opacityByType)).toMatchObject({
            color: "#8fa58f73",
            padding: [2, 3, 2, 3],
        });
        expect(createRoughNotationConfig(old, opacityByType).color).toBe("#8fa58fcc");
    });

    it("renders only FuturePlural marks, leaving native and third-party marks intact", async () => {
        const window = createObsidianWindow();
        const container = window.document.getElementById("content");
        container.innerHTML = [
            '<p><mark data-fp-notation="circle" data-fp-color="#8fa58f">Future</mark></p>',
            '<p><mark style="background-color: rgb(255, 204, 102)">Legacy</mark></p>',
            "<p><mark>Native Markdown</mark></p>",
        ].join("");

        const annotations = [];
        const annotateElement = vi.fn((_element, _config) => {
            const annotation = fakeAnnotation();
            annotations.push(annotation);
            return annotation;
        });
        const renderer = new RoughNotationRenderer(container, annotateElement);

        renderer.onload();
        expect(annotateElement).not.toHaveBeenCalled();

        await waitForAnimationFrame(window);

        expect(annotateElement).toHaveBeenCalledTimes(1);
        expect(annotateElement.mock.calls[0][1]).toMatchObject({
            type: "circle",
            color: "#8fa58fad",
        });
        expect(annotations.every((annotation) => annotation.show.mock.calls.length === 1)).toBe(true);
        expect(container.querySelectorAll("mark.fp-rough-notation-target")).toHaveLength(1);
        expect(container.querySelector("mark[style]")?.getAttribute("style")).toBe(
            "background-color: rgb(255, 204, 102)"
        );
        expect(container.querySelectorAll("mark:not(.fp-rough-notation-target)")).toHaveLength(2);

        renderer.onunload();

        expect(annotations.every((annotation) => annotation.remove.mock.calls.length === 1)).toBe(true);
        expect(container.querySelectorAll("mark.fp-rough-notation-target")).toHaveLength(0);
    });

    it("does not attach a second annotation to an active target", async () => {
        const window = createObsidianWindow();
        const container = window.document.getElementById("content");
        container.innerHTML = '<p><mark data-fp-notation="box">Once</mark></p>';

        const firstAnnotate = vi.fn(() => fakeAnnotation());
        const secondAnnotate = vi.fn(() => fakeAnnotation());
        const first = new RoughNotationRenderer(container, firstAnnotate);
        const second = new RoughNotationRenderer(container, secondAnnotate);

        first.onload();
        second.onload();

        await waitForAnimationFrame(window);

        expect(firstAnnotate).toHaveBeenCalledTimes(1);
        expect(secondAnnotate).not.toHaveBeenCalled();

        second.onunload();
        first.onunload();
    });

    it("ignores empty marks", async () => {
        const window = createObsidianWindow();
        const container = window.document.getElementById("content");
        container.innerHTML = "<mark>   </mark>";
        const annotateElement = vi.fn(() => fakeAnnotation());

        const renderer = new RoughNotationRenderer(container, annotateElement);
        renderer.onload();

        await waitForAnimationFrame(window);

        expect(annotateElement).not.toHaveBeenCalled();
    });

    it("cancels deferred rendering when its Markdown section unloads", async () => {
        const window = createObsidianWindow();
        const container = window.document.getElementById("content");
        container.innerHTML = "<mark>Unloaded</mark>";
        const annotateElement = vi.fn(() => fakeAnnotation());

        const renderer = new RoughNotationRenderer(container, annotateElement);
        renderer.onload();
        renderer.onunload();

        await waitForAnimationFrame(window);

        expect(annotateElement).not.toHaveBeenCalled();
    });
});
