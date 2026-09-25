import { describe, expect, it, vi } from "vitest";
import {
    createRoughNotationConfig,
    notationSeed,
    rectsChanged,
    RoughNotationRenderer,
} from "../src/core/RoughNotationRenderer";
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

function makeMarksMeasurable(container) {
    for (const mark of container.querySelectorAll("mark[data-fp-notation]")) {
        mark.getClientRects = () => [{ left: 10, top: 20, width: 40, height: 20 }];
    }
}

function controlledFrames(window) {
    const frames = new Map();
    let nextId = 0;
    window.requestAnimationFrame = (callback) => {
        const id = ++nextId;
        frames.set(id, callback);
        return id;
    };
    window.cancelAnimationFrame = (id) => frames.delete(id);
    return {
        pending: () => frames.size,
        step: () => {
            const ready = [...frames.values()];
            frames.clear();
            for (const callback of ready) callback(0);
        },
    };
}

function lifecycleFixture() {
    const window = createObsidianWindow();
    const frames = controlledFrames(window);
    const leaf = window.document.getElementById("content");
    leaf.classList.add("workspace-leaf");
    leaf.innerHTML = '<div class="markdown-reading-view"><p><mark data-fp-notation="box">A mark</mark></p></div>';
    const paragraph = leaf.querySelector("p");
    const mark = paragraph.querySelector("mark");
    let visible = true;
    let rects = [{ left: 10, top: 20, width: 40, height: 20 }];
    leaf.getBoundingClientRect = () => ({ width: visible ? 500 : 0, height: visible ? 300 : 0 });
    mark.getClientRects = () => rects;
    const svg = window.document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("rough-annotation");
    svg.getBoundingClientRect = () => ({ left: 0, top: 0 });
    const seeds = [];
    const annotation = { ...fakeAnnotation(), _seed: 987 };
    annotation.show.mockImplementation(() => {
        seeds.push(annotation._seed);
        svg.replaceChildren(window.document.createElementNS("http://www.w3.org/2000/svg", "path"));
    });
    const annotateElement = vi.fn(() => {
        mark.after(svg);
        return annotation;
    });
    const renderer = new RoughNotationRenderer(paragraph, annotateElement, undefined, "gate.md");
    renderer.onload();
    frames.step();
    frames.step();
    return {
        window,
        frames,
        leaf,
        paragraph,
        mark,
        svg,
        annotation,
        annotateElement,
        renderer,
        seeds,
        setVisible: (value) => (visible = value),
        setRects: (value) => (rects = value),
    };
}

describe("Rough Notation renderer", () => {
    it("treats rect-count transitions in both directions as geometry changes", () => {
        const rect = { x: 1, y: 2, width: 3, height: 4 };
        expect(rectsChanged([], [rect])).toBe(true);
        expect(rectsChanged([rect], [])).toBe(true);
        expect(rectsChanged([rect], [rect])).toBe(false);
    });

    it("does not show hidden marks and repairs a pathless SVG using the same seeded instance", () => {
        const f = lifecycleFixture();
        const seed = notationSeed(f.mark, "gate.md");
        expect(f.seeds).toEqual([seed]);
        f.setVisible(false);
        f.setRects([]);
        f.svg.replaceChildren();
        f.leaf.querySelector(".markdown-reading-view").dispatchEvent(new f.window.Event("scroll"));
        f.frames.step();
        expect(f.annotation.show).toHaveBeenCalledTimes(1);
        expect(f.frames.pending()).toBe(0);

        f.setVisible(true);
        const readingRoot = f.leaf.querySelector(".markdown-reading-view");
        readingRoot.style.display = "none";
        readingRoot.dispatchEvent(new f.window.Event("scroll"));
        f.frames.step();
        expect(f.annotation.show).toHaveBeenCalledTimes(1);
        expect(f.frames.pending()).toBe(0);

        readingRoot.style.display = "";
        f.setRects([{ left: 10, top: 20, width: 40, height: 20 }]);
        readingRoot.dispatchEvent(new f.window.Event("scroll"));
        f.frames.step();
        expect(f.annotation.show).toHaveBeenCalledTimes(2);
        expect(f.svg.querySelectorAll("path")).toHaveLength(1);
        expect(f.seeds).toEqual([seed, seed]);
        expect(f.annotateElement).toHaveBeenCalledTimes(1);
        f.renderer.onunload();
    });

    it("recovers disconnected known targets through bounded shared frames and stops after success", () => {
        const f = lifecycleFixture();
        f.mark.remove();
        f.svg.replaceChildren();
        f.leaf.querySelector(".markdown-reading-view").dispatchEvent(new f.window.Event("scroll"));
        f.frames.step();
        expect(f.frames.pending()).toBe(1);
        expect(f.annotation.show).toHaveBeenCalledTimes(1);
        f.frames.step();
        f.paragraph.prepend(f.mark);
        f.frames.step();
        expect(f.annotation.show).toHaveBeenCalledTimes(2);
        expect(f.frames.pending()).toBe(0);
        expect(f.annotateElement).toHaveBeenCalledTimes(1);
        f.renderer.onunload();
    });

    it("bounds failed attachment recovery and cancels pending frames on unload", () => {
        const f = lifecycleFixture();
        f.mark.remove();
        f.leaf.querySelector(".markdown-reading-view").dispatchEvent(new f.window.Event("scroll"));
        for (let i = 0; i < 8; i++) f.frames.step();
        expect(f.frames.pending()).toBe(0);
        expect(f.annotation.show).toHaveBeenCalledTimes(1);
        f.leaf.querySelector(".markdown-reading-view").dispatchEvent(new f.window.Event("scroll"));
        expect(f.frames.pending()).toBe(1);
        f.renderer.onunload();
        expect(f.frames.pending()).toBe(0);
        expect(f.annotation.remove).toHaveBeenCalledOnce();
    });

    it("rearms a detached section after its initial frame budget when the note attaches", () => {
        const window = createObsidianWindow();
        const frames = controlledFrames(window);
        const observers = [];
        window.ResizeObserver = class {
            constructor(callback) {
                this.callback = callback;
                this.observe = vi.fn();
                this.disconnect = vi.fn();
                observers.push(this);
            }
        };
        const host = window.document.getElementById("content");
        const root = window.document.createElement("div");
        root.className = "markdown-reading-view";
        const paragraph = window.document.createElement("p");
        paragraph.innerHTML = '<mark data-fp-notation="box">Late section</mark>';
        const mark = paragraph.querySelector("mark");
        mark.getClientRects = () => [{ left: 10, top: 20, width: 40, height: 20 }];
        const annotation = { ...fakeAnnotation(), _seed: 1 };
        const annotateElement = vi.fn(() => annotation);
        const renderer = new RoughNotationRenderer(paragraph, annotateElement, undefined, "late.md");
        renderer.onload();
        for (let i = 0; i < 8; i++) frames.step();
        expect(frames.pending()).toBe(0);
        expect(annotateElement).not.toHaveBeenCalled();

        root.append(paragraph);
        host.append(root);
        observers[0].callback([{ target: paragraph }]);
        frames.step();
        expect(annotateElement).toHaveBeenCalledOnce();
        expect(annotation.show).toHaveBeenCalledOnce();
        expect(annotation._seed).toBe(notationSeed(mark, "late.md"));
        expect(observers).toHaveLength(2);
        expect(observers[0].disconnect).toHaveBeenCalledOnce();
        renderer.onunload();
        expect(observers[1].disconnect).toHaveBeenCalledOnce();
        expect(frames.pending()).toBe(0);
    });
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
            annotation.show.mockImplementation(() => {
                svg.replaceChildren(window.document.createElementNS("http://www.w3.org/2000/svg", "path"));
            });
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
        root.getBoundingClientRect = () => ({ width: 350, height: 100 });
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
        makeMarksMeasurable(container);
        const first = new RoughNotationRenderer(container, annotateElement, undefined, "study.md");
        first.onload();
        await waitForAnimationFrame(window);
        const initialSeed = seeds[0];
        expect(initialSeed).toBeGreaterThan(0);
        first.onunload();

        container.innerHTML =
            '<p>A <mark data-fp-notation="circle">word</mark> and <mark data-fp-notation="box">another</mark> word.</p>';
        makeMarksMeasurable(container);
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
        makeMarksMeasurable(container);

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
