# node-red-contrib-beckhoff-nodes

Node-RED nodes for Beckhoff BK9100 bus couplers via Modbus TCP. Read and control Beckhoff KL-series I/O modules for building automation and industrial control.

## Installation

```bash
npm install node-red-contrib-beckhoff-nodes
```

Or install via Node-RED palette manager.

## Supported Cards

| Card | Type | Channels |
|------|------|----------|
| KL1804/08 | Digital Input | 4/8 |
| KL2404/08 | Digital Output | 4/8 |
| KL3204/08 | Temperature Input | 4/8 |
| KL3464/68 | Voltage Input (0-10V) | 4/8 |

## Quick Start

1. Add BK9100 node to your flow
2. Configure IP address and port (default: 502)
3. Add cards and set poll rate (default: 1000ms)
4. Connect outputs to process data

## Usage

### Reading Inputs

Each channel outputs separately:

```javascript
{
  topic: "KL1808/ch3",
  payload: {
    channel: 3,
    value: true
  }
}
```

### Controlling Outputs

Topic-based:
```javascript
msg.topic = "KL2408/ch5";
msg.payload = true;  // or false, 1, 0, "on", "off"
```

Object-based:
```javascript
msg.payload = {
  card: "KL2408",
  channel: 5,
  value: true
};
```

### Temperature Sensors (KL3204/08)

Configure sensor type per channel (Pt1000, Ni1000, NTC):

```javascript
{
  topic: "KL3208/ch2",
  payload: {
    channel: 2,
    celsius: 22.45,
    fahrenheit: 72.41,
    ok: true
  }
}
```

### Voltage Inputs (KL3464/68)

Configure range (0-10V, 0.5-10V, 2-10V):

```javascript
{
  topic: "KL3468/ch1",
  payload: {
    channel: 1,
    voltage: 7.35,
    percentage: 73.5
  }
}
```

## Configuration

**Global Settings:**
- IP Address, Port, Unit ID
- Poll Rate (ms) for inputs

**Per-Card Settings:**
- Custom poll rate (optional)
- Output cards: Poll states and read-back after write
- Temperature cards: Sensor type per channel
- Voltage cards: Range and manufacturer per channel

## License

MIT

## Support

Report issues at [GitHub](https://github.com/andreasgrontved/beckhoff-nodes/issues)