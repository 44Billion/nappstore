import { f, useStore, useTask } from '#f'

// Icon Sets:
// https://pictogrammers.com/library/mdi
// https://tabler.io/icons
//
// attachment/clip/paperclip is a good one to feel the icon pack style
// vector too checking if nodes are circles or (rounded or not) squares
//
// https://github.com/Pictogrammers/svg-icon
// You should make use of aria attributes to improve accessibility
// for users that use screen reading technology. You can use
// aria-labelledby to create a link between an icon and its label.
// A descriptive aria-label can be used to allow screen readers
// to announce an icon if there is no visual label to accompany it.
const noIcon = 'M0 0h24v24H0V0zm2 2v20h20V2H2z'
f(function aSvg () {
  const store = useStore(() => {
    const it = this
    return {
      // id is needed for styling while Firefox doesn't support @scope
      scopeId$: 'scope_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
      style$: this.props.style$ || this.props.style || '',
      // import { mdiAccount as path } from '@mdi/js'
      path$: this.props.path$ || this.props.paths$ || this.props.path || this.props.paths,
      _viewBox$: this.props.viewBox$ || this.props.viewbox$ || this.props.viewBox || this.props.viewbox,
      // it varies from icon set to icon set
      viewBox$ () { return this._viewBox$() || '0 0 24 24' },
      hadInitialSvg: !!(this.props.svg$ || this.props.svg),
      shouldKeepDefaultPathStyle$: this.props.shouldKeepDefaultPathStyle$ || this.props.shouldKeepDefaultPathStyle || !!(
        it.props.svg$ || it.props.svg
      ),
      class$: this.props.class$ || this.props.class || '',
      _svgStrings$: [],
      _svg$ () {
        const svg = it.props.svg$?.() || it.props.svg
        if (typeof svg !== 'string') return svg
        this._svgStrings$().length = 0
        this._svgStrings$().push(svg)
        return it.s(this._svgStrings$())
      },
      svg$ () {
        if (this._svg$()) return this._svg$()
        // https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute
        // https://github.com/Templarian/MaterialDesign-Web-Component/blob/master/src/mdi/icon/icon.ts
        return it.s`<svg
          class=${this.class$.get() /* uhtml's attr.set('class', classHandler) not working on svg; use a string */}
          xmlns="http://www.w3.org/2000/svg"
          viewBox=${this.viewBox$.get()}
        >
          ${(Array.isArray(this.path$.get()) ? this.path$.get() : [this.path$.get() || noIcon])
            .map((v, i) => it.s({ key: i })`<path key=${i} d=${v} />`)}
        </svg>`
      },
      color$: this.props.color$ || this.props.color || 'currentcolor',
      size$: this.props.size$ || this.props.size || '1em', // 1em is relative to own or ancestor's font-size
      _width$: this.props.width$ || this.props.width,
      _height$: this.props.height$ || this.props.height,
      width$: function () { return this._width$.get() ?? this.size$.get() },
      height$: function () { return this._height$.get() ?? this.size$.get() },
      // https://github.com/phosphor-icons/webcomponents
      // mays use star svg with weight='regular' to denote an empty star, and weight='fill' to denote a filled star
      weight$: this.props.weight$ || this.props.weight || ['thin', 'light', 'regular', 'bold', 'fill', 'duotone'][1],
      // https://m2.material.io/design/iconography/system-icons.html#icon-themes:~:text=If%20the%20stroke%20is%202dp%20or%20less%2C%20the%20corner%20radius%20must%20be%201dp.
      // ~~outlined~~/rounded/sharp
      corner$: this.props.corner$ || this.props.corner || ['rounded', 'sharp'][0],
      mirrored$: (this.props.mirrored$ || this.props.mirrored) ?? false, // use with rtl langs
      flip$: this.props.flip$ || this.props.flip || null,
      scale$: function () {
        let flip
        if (this.mirrored$.get()) flip = 'horizontal'
        else flip = this.flip$.get()
        if (!flip) return 'scale(1)'

        const flipX = ['both', 'horizontal'].includes(flip) ? '-1' : '1'
        const flipY = ['both', 'vertical'].includes(flip) ? '-1' : '1'
        return `scale(${flipX}, ${flipY})`
      },
      // https://github.com/iconmeister/iconmeister.github.io/blob/master/elements.iconmeister.js
      _rotate$: this.props.rotate$ || this.props.rotate || '0', // 0-360
      rotate$: function () { return `rotate(${this._rotate$.get()})` },
      _strokeWidth$: this.props.strokeWidth$ || this.props.strokeWidth,
      strokeWidth$: function () {
        return this._strokeWidth$() ?? ({
          thin: 1,
          light: 1.5,
          regular: 2,
          bold: 3,
          fill: 2,
          duotone: 2
        }[this.weight$.get()] || 0)
      },
      // duotone won't work if a path is used for background instead of a path's fill
      fill$: this.props.fill$ || this.props.fill || function () {
        return ['fill', 'duotone'].includes(this.weight$.get()) ? 'currentcolor' /* 'currentColor' if attr */ : 'none'
      },
      fillOpacity$: this.props.fillOpacity$ || this.props.fillOpacity || function () {
        return this.weight$.get() === 'duotone' ? '.2' : 'unset'
      }
    }
  })

  useTask(({ track }) => {
    track(() => [store.svg$.get(), store._viewBox$.get()])
    if (store.hadInitialSvg && store._viewBox$.get()) this.getElementsByTagName('svg')[0].setAttribute('viewBox', store._viewBox$.get())
  }, { after: 'rendering' })

  if (!store.svg$.get()) return

  // this.s`
  return this.h`<div id=${store.scopeId$()}>${this.s`
    <style>${/* css */`
      /* @scope { */
      #${store.scopeId$()} { display: contents;
        svg {
          /*
            Aligns at middle when no size is set (default 1em)
            if instead parent had set e.g. font-size: 36px;
            You may set it to vertical-align: middle; or other
            value using props.style$
          */
          vertical-align: bottom;
          pointer-events: bounding-box; /* clickable inside holes */
          stroke-width: ${store.strokeWidth$.get()}; /* add unit or it will depend on bbox's unit */
          color: ${store.color$.get() === 'currentColor' ? 'currentcolor' : store.color$.get()};
          transform: ${store.scale$.get()}
                     ${store.rotate$.get()};
          width: ${store.width$()};
          height: ${store.height$()};
        }
        ${store.shouldKeepDefaultPathStyle$()
          ? ''
          : `path {
          fill: ${store.fill$.get()};
          fill-opacity: ${store.fillOpacity$.get()};
          stroke: currentcolor;
          ${store.corner$.get() === 'sharp'
            ? ''
            : `
            stroke-linecap: round;
            stroke-linejoin: round;
          `}
        }`}
        ${store.style$.get()}
      }
    `}</style>${store.svg$.get()}
  `}</div>`
})
