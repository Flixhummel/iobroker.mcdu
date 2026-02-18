# Page Configuration Guide

## Overview

The MCDU adapter now supports full page configuration via the Admin UI!

## Configuration Interface

Navigate to: **Instances → mcdu.0 → Configure**

The configuration is organized into tabs:
- **MQTT Connection** - Broker settings
- **Pages** - Page configuration (NEW!)
- **Display** - Display settings  
- **Performance** - Throttling and queue settings
- **Advanced** - Debug logging

## Adding/Editing Pages

1. Go to the **Pages** tab
2. Click the **+** button to add a new page
3. Fill in:
   - **Page ID** - Unique identifier (lowercase, hyphens only). Example: `lights-main`
   - **Page Name** - Display name. Example: `Beleuchtung`
   - **Parent Page** - Optional parent for navigation
   - **Enabled** - Enable/disable this page
   - **Lines (JSON)** - Click "Edit Lines" to configure page content

## Line Configuration (JSON Format)

Each page can have up to 13 content lines (line 14 is the scratchpad).

Click **"Edit Lines"** to open the JSON editor.

### Line Structure

```json
[
  {
    "row": 1,
    "leftButton": {
      "type": "navigation",
      "action": "goto",
      "target": "lights-dimmer",
      "label": "DIMMER"
    },
    "display": {
      "type": "label",
      "label": "BELEUCHTUNG",
      "color": "white",
      "align": "left"
    },
    "rightButton": {
      "type": "empty"
    }
  },
  {
    "row": 2,
    "leftButton": {
      "type": "empty"
    },
    "display": {
      "type": "empty"
    },
    "rightButton": {
      "type": "empty"
    }
  }
]
```

### Button Types

**Navigation Button:**
```json
{
  "type": "navigation",
  "action": "goto",
  "target": "target-page-id",
  "label": "LABEL"
}
```

**Data Button (toggle/increment/decrement):**
```json
{
  "type": "datapoint",
  "action": "toggle",
  "target": "hm-rpc.0.ABC123.STATE",
  "label": "TOGGLE"
}
```

**Empty Button:**
```json
{
  "type": "empty"
}
```

### Display Types

**Label (static text):**
```json
{
  "type": "label",
  "label": "HELLO WORLD",
  "color": "white",
  "align": "left"
}
```

**Datapoint (live value):**
```json
{
  "type": "datapoint",
  "source": "javascript.0.temperature",
  "color": "green",
  "align": "right",
  "format": "%.1f°C"
}
```

**Empty:**
```json
{
  "type": "empty"
}
```

### Colors

Available colors: `white`, `green`, `blue`, `amber`, `red`

### Alignment

Available alignments: `left`, `center`, `right`

## Example: Complete 3-Page Configuration

### Page 1: Main Menu
```json
{
  "id": "home-main",
  "name": "Hauptmenü",
  "parent": null,
  "enabled": true,
  "lines": [
    {
      "row": 1,
      "leftButton": {"type": "navigation", "action": "goto", "target": "lights-main", "label": "LIGHTS"},
      "display": {"type": "label", "label": "BELEUCHTUNG", "color": "white", "align": "left"},
      "rightButton": {"type": "empty"}
    },
    {
      "row": 3,
      "leftButton": {"type": "navigation", "action": "goto", "target": "climate-main", "label": "CLIMATE"},
      "display": {"type": "label", "label": "KLIMA", "color": "white", "align": "left"},
      "rightButton": {"type": "empty"}
    },
    {
      "row": 5,
      "leftButton": {"type": "navigation", "action": "goto", "target": "status-main", "label": "STATUS"},
      "display": {"type": "label", "label": "SYSTEM STATUS", "color": "white", "align": "left"},
      "rightButton": {"type": "empty"}
    }
  ]
}
```

### Page 2: Lights Control
```json
{
  "id": "lights-main",
  "name": "Beleuchtung",
  "parent": "home-main",
  "enabled": true,
  "lines": [
    {
      "row": 1,
      "leftButton": {"type": "datapoint", "action": "toggle", "target": "hm-rpc.0.ABC123.STATE", "label": "TOGGLE"},
      "display": {"type": "label", "label": "WOHNZIMMER", "color": "white", "align": "left"},
      "rightButton": {"type": "datapoint", "action": "toggle", "target": "hm-rpc.0.ABC123.STATE"}
    },
    {
      "row": 3,
      "leftButton": {"type": "datapoint", "action": "toggle", "target": "hm-rpc.0.DEF456.STATE", "label": "TOGGLE"},
      "display": {"type": "label", "label": "KÜCHE", "color": "white", "align": "left"},
      "rightButton": {"type": "datapoint", "action": "toggle", "target": "hm-rpc.0.DEF456.STATE"}
    },
    {
      "row": 11,
      "leftButton": {"type": "navigation", "action": "goto", "target": "home-main", "label": "BACK"},
      "display": {"type": "empty"},
      "rightButton": {"type": "empty"}
    }
  ]
}
```

### Page 3: Climate Control
```json
{
  "id": "climate-main",
  "name": "Klima",
  "parent": "home-main",
  "enabled": true,
  "lines": [
    {
      "row": 1,
      "leftButton": {"type": "datapoint", "action": "decrement", "target": "hm-rpc.0.TEMP123.SET_TEMPERATURE"},
      "display": {"type": "datapoint", "source": "hm-rpc.0.TEMP123.ACTUAL_TEMPERATURE", "format": "%.1f°C", "color": "green", "align": "center"},
      "rightButton": {"type": "datapoint", "action": "increment", "target": "hm-rpc.0.TEMP123.SET_TEMPERATURE"}
    },
    {
      "row": 11,
      "leftButton": {"type": "navigation", "action": "goto", "target": "home-main", "label": "BACK"},
      "display": {"type": "empty"},
      "rightButton": {"type": "empty"}
    }
  ]
}
```

## Tips

1. **Start simple** - Begin with basic label pages, then add datapoints
2. **Test incrementally** - Add one page at a time and test
3. **Use parent navigation** - Set parent pages for automatic breadcrumb navigation
4. **Row numbers** - Use odd rows (1, 3, 5, 7, 9, 11) for main content, even rows for spacing
5. **Always provide a back button** - Use row 11 or 12 for navigation back to parent

## Validation

The admin UI validates:
- Page IDs (must be lowercase with hyphens)
- JSON syntax in line configuration
- Required fields

## Next Steps

After configuring pages:
1. Save the configuration
2. Restart the adapter
3. Test navigation on your MCDU hardware
4. Iterate and refine!
