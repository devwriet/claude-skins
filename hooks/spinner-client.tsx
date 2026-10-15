import type { ClientModule } from 'claude-code'

import { spinnerRow } from './rows'

const FRAME_MS = 90

type Props = {
  word: string
  frames: string[]
  palette: { fg: string; user: string; muted: string }
  startedAt: number
  elapsedMs: number
}

type State = { frame: number; elapsedMs: number; startedAt: number }

const spinner: ClientModule<Props, State> = (props, surface) => {
  let state = surface.state

  if (state === undefined) {
    surface.every(FRAME_MS, () => {
      const current = surface.state

      if (current !== undefined) {
        surface.setState({ ...current, frame: current.frame + 1, elapsedMs: current.elapsedMs + FRAME_MS })
      }
    })
    state = { frame: 0, elapsedMs: props.elapsedMs, startedAt: props.startedAt }
    surface.setState(state)
  } else if (state.startedAt !== props.startedAt || props.elapsedMs > state.elapsedMs) {
    state = {
      ...state,
      startedAt: props.startedAt,
      elapsedMs: props.elapsedMs,
    }
    surface.setState(state)
  }

  return spinnerRow(
    { icons: { frames: props.frames }, skin: { palette: props.palette }, ui: surface.elements },
    props.word,
    state.frame,
    state.elapsedMs,
  )
}

export default spinner
