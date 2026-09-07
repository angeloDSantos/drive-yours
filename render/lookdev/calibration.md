# Tint calibration

Measured on 5.2.0 LTS, Cycles, 256 samples, orthographic through the assembled laminate against a unit white emitter, linear light.

- Untinted laminate transmission (`clear_t`): **0.9173**
- Absorption density in the ceramic volume: `-ln(vlt / clear_t) / thickness`

| Button says | Render transmits | Error |
|---|---|---|
| VLT 70 | 70.16 % | +0.16 pts |
| VLT 35 | 35.23 % | +0.23 pts |
| VLT 20 | 20.22 % | +0.22 pts |
| VLT 5 | 5.11 % | +0.11 pts |

Acceptance: every row within 1 point. **Pass.**
