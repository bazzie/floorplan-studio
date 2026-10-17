# Floorplan Studio

[![Open your Home Assistant instance and open this repository in HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=bazzie&repository=floorplan-studio&category=integration)

A Home Assistant integration that adds a **Floorplan** panel to the sidebar. Draw your home in the browser and view it live in 2D or 3D.

![The plan in 2D: rooms in the colour of their lights, temperatures, open doors and windows, and furniture linked to entities](https://raw.githubusercontent.com/bazzie/floorplan-studio/main/docs/images/plan-2d.png)

![The same home in 3D, with low walls: lamps that are on light up their rooms](https://raw.githubusercontent.com/bazzie/floorplan-studio/main/docs/images/view-3d.png)

![Both floors at once: the first floor above the ground floor, with low walls, the stairs up through the stairwell and an almost see-through roof](https://raw.githubusercontent.com/bazzie/floorplan-studio/main/docs/images/levels-3d.png)

- **Editor** (available to all users): walls, rooms, doors, windows and entity markers. It snaps to a grid and to existing corners, and has undo/redo.
- **Blueprint**: upload an image of your floorplan and trace over it. *Calibrate scale* sets the real size from two points whose distance you know.
- **Multiple floors**, each with its own level and wall height. Staircases reach the floor above, and a floor opening (stairwell, vide) cuts through it. In 3D, *All floors* shows them stacked, and a roof can be made see-through.
- **Live state**:
  - Rooms light up in the color of a linked light or switch.
  - Rooms can show a sensor value.
  - Doors and windows show as open when a linked contact sensor is open.
- **Tap actions**: tap a marker to toggle it or open HA's more-info dialog. Tap a room to open its entity.
- **Furniture**: a catalog of furniture, lamps, appliances, media and smart-home devices (Sonos, Philips Hue), garden pieces and more, the same in 2D and 3D. Link a piece to an entity and it comes alive:
  - lamps light up their room (in 3D with real light and shadows),
  - TVs show what's playing, speakers show sound waves,
  - fans spin, radiators glow, a robot vacuum drives through the room it cleans,
  - a washing machine's drum turns while it runs.
- **3D view**: walls are extruded with door and window openings, and floors are stacked.
  - Drag to rotate; Shift-drag or right-drag to pan; scroll or pinch to zoom.
  - *Low walls* lowers the walls so you can look inside.
  - *All floors* shows the floors above the selected one.
  - Day and night follow the sun.
- **Light on slower devices**: the views only redraw when something on the plan changes (not for every state change in the house). Wall tablets and phones get a lighter 3D profile automatically (fewer pixels, simpler shadows, fewer lights, slower animation): picked by the GPU model where the browser names it (Chrome, Edge, the Home Assistant app on Android), otherwise measured once on the device (iPhone, iPad). While in use, the resolution drops when frames come too slowly, and a device that stays too slow switches to the light profile. *Quality* in the side panel overrides it per device.
- **3D scan import**: start from a LiDAR room scan (an OBJ from an iPhone or iPad app using Apple RoomPlan, such as 3D Snap): walls, doors, windows, rooms and furniture blocks.

## Install

### With HACS (recommended)

1. Click this button to open the repository in HACS on your own Home Assistant:

   [![Open your Home Assistant instance and open this repository in HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=bazzie&repository=floorplan-studio&category=integration)

   Or add it by hand: **HACS → ⋮ (top right) → Custom repositories**, repository
   `https://github.com/bazzie/floorplan-studio`, type **Integration**.
2. Click **Download** (bottom right), then **Download** again to confirm.
3. Restart Home Assistant (**Settings → System → ⏻ → Restart Home Assistant**).
4. Add the integration:

   [![Open your Home Assistant instance and start setting up Floorplan Studio.](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=floorplan_studio)

   Or: **Settings → Devices & services → Add integration → Floorplan Studio**.

A **Floorplan** item appears in the sidebar. HACS shows an update when a new version is
released.

### Manually

Copy `custom_components/floorplan_studio` from the [latest release](https://github.com/bazzie/floorplan-studio/releases/latest)
into `<config>/custom_components/`, restart Home Assistant and add the integration as in step 4.

Requires Home Assistant 2024.7 or newer. three.js is bundled, so it works offline.

## Using the editor

![The editor: tools on the left, the furniture catalog on the right](https://raw.githubusercontent.com/bazzie/floorplan-studio/main/docs/images/editor.png)

Click **Edit**, choose a tool on the left, and set properties in the panel on the right. Changes are saved automatically about a second after you stop editing. The header shows *Saving…*, *All changes saved*, or *Save failed* with a **Retry** button. **Done** saves anything pending and closes the editor.

| Key | Tool / action |
| --- | --- |
| V | Select / move (drag wall ends, room corners, items) |
| W | Wall: click points; double-click / right-click / Enter / Esc to finish |
| R | Room: click corners, then click the first point (or Enter) to close |
| D / N | Door / window: click on a wall (a selected door has *Flip hinge* and *Flip opening* buttons) |
| M | Entities: search all entities and drag them onto the plan |
| F | Furniture: drag pieces from the catalog; corners resize, the round handle rotates |
| Ctrl+D | Duplicate the selected furniture |
| C | Calibrate blueprint scale |
| Shift | Lock to 45° while drawing |
| Alt | Disable snapping |
| Delete | Delete selection |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Ctrl+S | Save now instead of waiting a second |

Units are metres. Joined walls move together when you drag a wall or its end. Grid size (5 cm to 1 m) and snapping are set in the bottom bar and remembered per browser. To place entities, select a room linked to an HA area and drag its entities from the side panel onto the plan. Or use the Entities tool (M) to search all entities. Remove a marker or a piece of furniture by dragging it off the plan onto the side panel. To link an entity to furniture, drop the entity onto the piece or pick it in the side panel. A linked lamp glows and lights the room, a TV's screen lights up, other pieces get a highlight, and tapping the piece toggles it or opens its popup. An optional badge shows the entity's state. Furniture linked to a media player (TV, speakers, the Sonos range) sends out pulsing sound rings while it plays. *Raised (m)* puts a piece on top of something, such as a speaker on a shelf. To set which way is north, drag the compass in the top-right corner while editing (Alt for 1° steps, double-click to reset) or type the angle under *House* in the side panel. The compass also turns with the camera in 3D. If two people edit at once, the last change saved wins.

## Finishes

Select a room to choose its **floor** finish (wood, herringbone, tiles 30 cm, 40 × 25 cm or 60 cm, carpet, concrete, marble) and the finish of **its side of the walls** (paint, brick, wallpaper, wood panelling, tiles, concrete), each with a colour. A wall between two rooms can look different on each side. Under *House*, **Exterior walls** sets the outside of the house. Textures are shown at real-world size in 3D, and floors get a matching pattern in 2D.

## Day and night

The sun button in the header switches between **Auto**, **Day** and **Night**. Each device remembers its own setting.

- **Auto** follows Home Assistant's `sun.sun`. Without `sun.sun` it goes by the clock.
- **Day:** in 3D, sunlight comes from the sun's real direction and height (using the north setting), with warm, long shadows around sunset.
- **Night:** the scene goes dark so lamps, beams and screens stand out. The 2D plan dims as well.

## How it's stored

- **Floorplan**: `.storage/floorplan_studio`, edited over the websocket API (`floorplan_studio/get`, `/save`, `/subscribe`). Other open browsers update live.
- **Blueprint images**: `<config>/floorplan_studio/`, served only to logged-in users. PNG, JPEG, WebP, AVIF and GIF up to 15 MB are accepted, recognised by their contents rather than the file name; SVG is refused because it can contain scripts.

## Changelog

What changed in each version: [CHANGELOG.md](CHANGELOG.md) and the [releases](https://github.com/bazzie/floorplan-studio/releases).

