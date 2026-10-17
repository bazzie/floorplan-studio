# Floorplan Studio

A Home Assistant integration that adds a **Floorplan** panel to the sidebar. Draw your home in the browser and view it live in 2D or 3D.

- **Editor** (available to all users): walls, rooms, doors, windows and entity markers. It snaps to a grid and to existing corners, and has undo/redo.
- **Blueprint**: upload an image of your floorplan and trace over it. *Calibrate scale* sets the real size from two points whose distance you know.
- **Multiple floors**, each with its own level and wall height.
- **Live state**:
  - Rooms light up in the color of a linked light or switch.
  - Rooms can show a sensor value.
  - Doors and windows show as open when a linked contact sensor is open.
- **Tap actions**: tap a marker to toggle it or open HA's more-info dialog. Tap a room to open its entity.
- **3D view**: walls are extruded with door and window openings, and floors are stacked.
  - Drag to rotate; Shift-drag or right-drag to pan; scroll or pinch to zoom.
  - *Low walls* lowers the walls so you can look inside.
  - *All floors* shows the floors above the selected one.

## Install

**HACS**: add this repository as a custom repository (type *Integration*), install *Floorplan Studio*, and restart HA.

**Manual**: copy `custom_components/floorplan_studio` into `<config>/custom_components/` and restart HA.

Then go to **Settings → Devices & services → Add integration → Floorplan Studio**. A **Floorplan** item appears in the sidebar.

Requires Home Assistant 2024.7 or newer. three.js is bundled, so it works offline.

## Using the editor

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

