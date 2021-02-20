
var Extension;
if (imports.misc.extensionUtils.extensions) {
    Extension = imports.misc.extensionUtils.extensions["paperwm@hedning:matrix.org"];
} else {
    Extension = imports.ui.main.extensionManager.lookup("paperwm@hedning:matrix.org");
}

var St = imports.gi.St;
var Main = imports.ui.main;

var Tiling = Extension.imports.tiling;
var Scratch = Extension.imports.scratch;
var prefs = Extension.imports.settings.prefs;
var Utils = Extension.imports.utils;
var Tweener = Utils.tweener;


function isInRect(x, y, r) {
    return r.x <= x && x < r.x + r.width &&
        r.y <= y && y < r.y + r.height;
}


function monitorAtPoint(gx, gy) {
    for (let monitor of Main.layoutManager.monitors) {
        if (isInRect(gx, gy, monitor))
            return monitor;
    }
    return null;
}

var MoveGrab = class MoveGrab {
    constructor(metaWindow, type) {
        this.window = metaWindow;
        this.type = type;
        this.signals = new Utils.Signals();

        this.initialSpace = Tiling.spaces.spaceOfWindow(metaWindow);
    }

    begin() {
        let metaWindow = this.window;
        let frame = metaWindow.get_frame_rect();
        let space = Tiling.spaces.spaceOfWindow(metaWindow);

        this.initialY = frame.y;

        let actor = metaWindow.get_compositor_private();
        let [gx, gy, $] = global.get_pointer();
        let px = (gx - actor.x) / actor.width;
        let py = (gy - actor.y) / actor.height;
        actor.set_pivot_point(px, py);

        let clone = metaWindow.clone;
        let [x, y] = space.globalToScroll(gx, gy);
        px = (x - clone.x) / clone.width;
        py = (y - clone.y) / clone.height;
        clone.set_pivot_point(px, py);

        this.scrollAnchor = metaWindow.clone.targetX + space.monitor.x;
        this.signals.connect(
            metaWindow, 'position-changed', this.positionChanged.bind(this)
        );
        space.startAnimate();
        // Make sure the window actor is visible
        Tiling.showWindow(metaWindow);
        Tweener.removeTweens(space.cloneContainer);
    }


    positionChanged(metaWindow) {
        Utils.assert(metaWindow === this.window);

        let [gx, gy, $] = global.get_pointer();

        let space = this.initialSpace;
        let clone = metaWindow.clone;
        let frame = metaWindow.get_frame_rect();
        space.targetX = frame.x - this.scrollAnchor;
        space.cloneContainer.x = space.targetX;

        const threshold = 300;
        const dy = Math.min(threshold, Math.abs(frame.y - this.initialY));
        let s = 1 - Math.pow(dy / 500, 3);
        let actor = metaWindow.get_compositor_private();
        actor.set_scale(s, s);
        clone.set_scale(s, s);
        [clone.x, clone.y] = space.globalToScroll(frame.x, frame.y);
    }

    end() {
        this.signals.destroy();

        let metaWindow = this.window;
        let actor = metaWindow.get_compositor_private();
        let frame = metaWindow.get_frame_rect();
        let clone = metaWindow.clone;
        let [gx, gy, $] = global.get_pointer();

        // NOTE: we reset window here so `window-added` will handle the window,
        // and layout will work correctly etc.
        this.window = null;

        this.initialSpace.layout();

        let monitor = monitorAtPoint(gx, gy);
        let space = Tiling.spaces.monitors.get(monitor);

        // Make sure the window is on the correct workspace.
        // If the window is transient this will take care of its parent too.
        metaWindow.change_workspace(space.workspace)
        space.workspace.activate(global.get_current_time());
    }
}

var ResizeGrab = class ResizeGrab {
    constructor(metaWindow, type) {
        this.window = metaWindow;
        this.signals = new Utils.Signals();

        this.space = Tiling.spaces.spaceOfWindow(metaWindow);
        if (this.space.indexOf(metaWindow) === -1)
            return;

        this.scrollAnchor = metaWindow.clone.targetX + this.space.monitor.x;

        this.signals.connect(metaWindow, 'size-changed', () => {
            metaWindow._targetWidth = null;
            metaWindow._targetHeight = null;
            let frame = metaWindow.get_frame_rect();

            this.space.targetX = frame.x - this.scrollAnchor;
            this.space.cloneContainer.x = this.space.targetX;
            this.space.layout(false);
        })
    }
    end() {
        this.signals.destroy();

        this.window = null;
        this.space.layout();
    }
}
