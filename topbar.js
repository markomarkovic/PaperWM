/*
  Functionality related to the top bar, often called the statusbar.
 */

var Extension;
if (imports.misc.extensionUtils.extensions) {
    Extension = imports.misc.extensionUtils.extensions["paperwm@hedning:matrix.org"];
} else {
    Extension = imports.ui.main.extensionManager.lookup("paperwm@hedning:matrix.org");
}

var Meta = imports.gi.Meta;
var St = imports.gi.St;
var Gio = imports.gi.Gio;
var GLib = imports.gi.GLib;
var PanelMenu = imports.ui.panelMenu;
var PopupMenu = imports.ui.popupMenu;
var Clutter = imports.gi.Clutter;
var Main = imports.ui.main;
var Tweener = Extension.imports.utils.tweener;

var Tiling = Extension.imports.tiling;
var Navigator = Extension.imports.navigator;
var Utils = Extension.imports.utils;
var Scratch = Extension.imports.scratch;

var Settings = Extension.imports.settings;
var prefs = Settings.prefs;

var panelBox = Main.layoutManager.panelBox;
var panelMonitor;

var workspaceManager = global.workspace_manager;
var display = global.display;


// From https://developer.gnome.org/hig-book/unstable/design-color.html.en
var colors = [
    '#9DB8D2', '#7590AE', '#4B6983', '#314E6C',
    '#EAE8E3', '#BAB5AB', '#807D74', '#565248',
    '#C5D2C8', '#83A67F', '#5D7555', '#445632',
    '#E0B6AF', '#C1665A', '#884631', '#663822',
    '#ADA7C8', '#887FA3', '#625B81', '#494066',
    '#EFE0CD', '#E0C39E', '#B39169', '#826647',
    '#DF421E', '#990000', '#EED680', '#D1940C',
    '#46A046', '#267726', '#ffffff', '#000000'
];

var WorkspaceMenu = Utils.registerClass(
class WorkspaceMenu extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Workspace', false);

        this.actor.name = 'workspace-button';

        let scale = display.get_monitor_scale(Main.layoutManager.primaryIndex);
        this._label = new St.Label({
            y_align: Clutter.ActorAlign.CENTER,
            // Avoid moving the menu on short names
            // TODO: update on scale changes
            min_width: 60*scale
        });

        this.setName(Meta.prefs_get_workspace_name(workspaceManager.get_active_workspace_index()));

        this.actor.add_actor(this._label);

        this.signals = new Utils.Signals();
        this.signals.connect(global.window_manager,
                             'switch-workspace',
                             this.workspaceSwitched.bind(this));

        this.state = "NORMAL";
    }

    _finishWorkspaceSelect() {
        this.state = "NORMAL";
        this._enterbox.destroy();
        delete this.selected;
        delete this._enterbox;
        delete this._navigator;
    }

    _onEvent(actor, event) {
        if (!this.menu) {
            log("?? no menu ??");
            Utils.print_stacktrace();
            return Clutter.EVENT_PROPAGATE;
        }

        if (this.state === "MENU" && !this.menu.isOpen) {
            this.state = "NORMAL";
        }

        let type = event.type();

        if ((type == Clutter.EventType.TOUCH_END ||
             type == Clutter.EventType.BUTTON_RELEASE)) {
            if (Navigator.navigating) {
                Navigator.getNavigator().finish();
            } else {
                if (this.menu.isOpen) {
                    this.menu.toggle();
                } else if (event.get_button() === Clutter.BUTTON_SECONDARY) {
                    this.menu.toggle();
                } else {
                    Main.overview.toggle();
                }
                this.state = this.menu.isOpen ? "MENU" : "NORMAL";
            }
            return Clutter.EVENT_PROPAGATE;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_event(event) {
        // Ugly hack to work on 3.34 at the same time as 3.36> vfunc_event is
        // active on 3.34, but upstream still connects _onEvent resulting in
        // double events.
        if (Utils.version[1] < 35) {
            return;
        }
        this._onEvent(null, event)
    }

    // WorkspaceMenu.prototype._onOpenStateChanged = function
    _onOpenStateChanged(menu, open) {
        if (!open)
            return;

        let space = Tiling.spaces.spaceOf(workspaceManager.get_active_workspace());
        this.entry.label.text = space.name;
        GLib.idle_add(GLib.PRIORITY_DEFAULT, this.entry.activate.bind(this.entry));

        // this._zenItem._switch.setToggleState(!space.showTopBar);
    }

    workspaceSwitched(wm, fromIndex, toIndex) {
        updateWorkspaceIndicator(toIndex);
    }

    destroy() {
        this.signals.destroy();
        super.destroy();
    }

    setName(name) {
        if (prefs.use_workspace_name)
            this._label.text = name;
        else
            this._label.text = orginalActivitiesText;
    }
});

var menu;
var orginalActivitiesText;
var screenSignals, signals;
function init () {
    let label = Main.panel.statusArea.activities.actor.first_child;
    orginalActivitiesText = label.text;
    screenSignals = [];
    signals = new Utils.Signals();
}

var panelBoxShowId, panelBoxHideId;
function enable () {
    Main.panel.statusArea.activities.actor.hide();

    menu = new WorkspaceMenu();
    // Work around 'actor' warnings
    let panelActor = Main.panel.actor;
    function fixLabel(label) {
        let point = new Clutter.Vertex({x: 0, y: 0});
        let r = label.apply_relative_transform_to_point(panelActor, point);

        for (let [workspace, space] of Tiling.spaces) {
            space.label.set_position(panelActor.x + Math.round(r.x), panelActor.y + Math.round(r.y));
            let fontDescription = label.clutter_text.font_description;
            space.label.clutter_text.set_font_description(fontDescription);
        }
    }
    Main.panel.addToStatusArea('WorkspaceMenu', menu, 0, 'left');
    menu.actor.show();

    // Force transparency
    panelActor.set_style('background-color: rgba(0, 0, 0, 0.35);');
    [Main.panel._rightCorner, Main.panel._leftCorner]
        .forEach(c => c.actor.opacity = 0);

    screenSignals.push(
        workspaceManager.connect_after('workspace-switched',
                                    (workspaceManager, from, to) => {
                                        updateWorkspaceIndicator(to);
                                    }));

    signals.connect(Main.overview, 'showing', fixTopBar);
    signals.connect(Main.overview, 'hidden', () => {
        if (Tiling.spaces.selectedSpace.showTopBar)
            return;
        fixTopBar();
    });

    signals.connect(Settings.settings, 'changed::topbar-follow-focus', (settings, key) => {
        let monitors = Tiling.spaces.monitors;
        if (!settings.prefs.topbar_follow_focus) {
            moveTopBarTo(Main.layoutManager.primaryMonitor);
        }
        let to = setMonitor(Main.layoutManager.focusMonitor);
        let space = monitors.get(to);
        updateWorkspaceIndicator(space.workspace.index());
        for (let [workspace, space] of Tiling.spaces) {
            space.layout();
        }
    });

    signals.connect(panelBox, 'show', () => {
        fixTopBar();
    });
    signals.connect(panelBox, 'hide', () => {
        fixTopBar();
    });

    fixLabel(menu._label);
    signals.connect(menu._label, 'notify::allocation', fixLabel);
    signals.connectOneShot(menu._label, 'notify::allocation', () => {
        setMonitor(Main.layoutManager.primaryMonitor);
    })
}

function disable() {
    signals.destroy();
    menu.destroy();
    menu = null;
    Main.panel.statusArea.activities.actor.show();
    Main.panel.actor.set_style('');
    [Main.panel._rightCorner, Main.panel._leftCorner]
        .forEach(c => c.actor.opacity = 255);

    screenSignals.forEach(id => workspaceManager.disconnect(id));
    screenSignals = [];

    panelBox.scale_y = 1;
}

function fixTopBar() {
    let spaces = Tiling.spaces
    if (!spaces)
        return;
    let space = spaces.monitors.get(panelMonitor);
    if (!space)
        return;
    let normal = !Main.overview.visible && !Tiling.inPreview
    let selected = spaces.monitors.get(panelMonitor).selectedWindow
    let focus = display.focus_window
    let focusIsScratch = focus && Scratch.isScratchWindow(focus)
    let fullscreen = selected && selected.fullscreen && !(focusIsScratch);
    let hideTopBar = !spaces.monitors.get(panelMonitor).showTopBar
    if (normal && hideTopBar) {
        // Update the workarea to support hide top bar
        panelBox.scale_y = 0;
        panelBox.hide();
        return;
    }
    if (normal && fullscreen) {
        panelBox.hide();
        return;
    }
    panelBox.scale_y = 1;
    panelBox.show();
}

/**
   Override the activities label with the workspace name.
   let workspaceIndex = 0
*/
function updateWorkspaceIndicator (index) {
    let spaces = Tiling.spaces;
    let space = spaces && spaces.spaceOf(workspaceManager.get_workspace_by_index(index));
    let onMonitor = space && space.monitor === panelMonitor;
    let nav = Navigator.navigator
    if (onMonitor || (Tiling.inPreview && nav && nav.from.monitor === panelMonitor))
        setWorkspaceName(space.name);
};

function setWorkspaceName (name) {
    menu && menu.setName(name);
}

function setMonitor(monitor) {
    if (prefs.topbar_follow_focus) {
        moveTopBarTo(monitor);
    } else {
        monitor = Main.layoutManager.primaryMonitor
    }
    panelMonitor = monitor;
    return monitor;
}

function moveTopBarTo(monitor) {
    let panelBox = Main.layoutManager.panelBox;
    panelMonitor = monitor;
    panelBox.set_position(monitor.x, monitor.y);
    panelBox.width = monitor.width;
    fixTopBar();
    return monitor;
}
