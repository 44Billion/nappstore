import { f, useStore } from '#f'
import '#shared/svg.js'

f('iconStackFront', function () {
  // https://tabler.io/icons/icon/stack-front
  const store = useStore({
    path$: [
      'M12 4l-8 4l8 4l8 -4l-8 -4',
      'M8 14l-4 2l8 4l8 -4l-4 -2',
      'M8 10l-4 2l8 4l8 -4l-4 -2'
    ],
    style$: () => {
      return `
        path:nth-of-type(1) { fill: currentColor; }
        ${this.props.style$?.() || this.props.style || ''}
      `
    },
    viewBox$: '2 2 20 20'
  })

  return this.h`<a-svg
    props=${{
      ...store,
      ...this.props
    }}
  />`
})
