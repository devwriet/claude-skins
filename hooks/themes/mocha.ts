import type { Skin } from '../skin'

const skin: Skin = {
  name: 'mocha',
  label: 'Catppuccin Mocha (colour)',
  palette: {
    read: '#b4befe',
    write: '#f9e2af',
    run: '#f2cdcd',
    search: '#74c7ec',
    web: '#89dceb',
    mcp: '#f5e0dc',
    other: '#bac2de',
    user: '#f5c2e7',
    fg: '#cdd6f4',
    muted: '#7f849c',
    surface: '#313244',
    zebra: '#292a3c',
    ok: '#a6e3a1',
    err: '#f38ba8',
    warn: '#f9e2af',
  },
  // One colour per model, none of them used by a tool row or a status mark.
  models: { opus: '#fab387', sonnet: '#89b4fa', haiku: '#94e2d5', fable: '#cba6f7' },
  spinner: ['Purring', 'Napping', 'Pouncing', 'Kneading', 'Stretching', 'Nuzzling'],
  done: ['Pounced', 'Purred', 'Napped', 'Curled up'],
}

export default skin
