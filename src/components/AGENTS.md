# src/component folder

- Place front-end components here. These are custom elements
created with the help of 'thenameisf' library (a front-end framework) and its
`f` function.

## General Instructions:

- Read the code snippet example below and its comments to learn how to use the
`thenameisf` library.

```js
// #f is in fact the 'thenameisf' lib due to the corresponding
// package.json's `imports` field entry.
//
// 'thenameisf' lib is a front-end framework that works
// on the browser but not on Node.js. It is similar
// to React but uses the signals reactive programming paradigm.
import { f, useStore, useClosestStore, useGlobalStore, useTask, useCallback } from '#f'
// Now we can use the <f-to-signals> component (a custom element),
// explained later.
import '#f/components/f-to-signals.js'

// This component, declared with a camel-case function name,
// creates a custom element <a-example>; it auto-converts to kebab-case HTML tag name.
// Note that the component name must have a dash (-) in it
// to be a valid custom element name, that's why we can't call it <example>,
// because of this limitation, we add the 'a' prefix for components
// that would otherwise have no prefix, although the component's filename would be just 'example.js'
// in this case, or 'example/index.js'.
f(function aExample () {
  const storeA = useStore(() => ({
    // A signal, because the key ends with $ and the value is not a function
    signalExample$: 'any value',
    anotherSignalExample$: 'hello',
    // A computed (that is a special kind of signal, with just a getter but no setter),
    // because the key ends with $ and the value is a function
    // This also shows how to access other store values and component props
    computedExample$: () =>
      storeA.signalExample$().toUpperCase() +
      (this.props.suffix$?.() ?? '') + // this is getting the value of a signal or computed prop
      (this.props.suffix2 ?? ''), // this is a non-reactive prop, because the key doesn't end with $
    // a lazy signal, because the key ends with $
    // and, although the value is a function, it has a strategy property set to 'signal'
    lazySignalExample$: (() => {
      // "heavyComputation" call may even return a function or any value.
      // const fn = () => heavyComputation()
      const fn = () => 'lazy value'
      // without this, the store would think lazySignalExample$ is a computed property
      fn.strategy = 'signal'
      return fn
    })(),
    // A non-reactive property, because the key doesn't end with $
    names: ['Arthur', 'Ford', 'Trillian'],
    selectedName: 'Arthur',
    // There are non-reactive properties too. The value is a function, so it
    // behaves like a memoed callback
    setSelectedName: () => { storeA.selectedName = 'Ford' },
    setSelectedNameAlternative () { this.selectedName = 'Ford' },
    otherCallback: e => console.log('clicked', e.target),
    // This is like a React's render-prop. The reason to explicitly use
    // useCallback instead of just a regular function, is to prevent altering
    // the meaning of 'this'.
    render: useCallback(function () {
      return this.h`<permission-dialog-stack />`
    })
  }))

  // A store that works similar to one inited by useStore
  // but it behaves like a React.js's context, i.e., it can
  // be accessed by this component's children (or any component in the sub-tree)
  // by calling useClosestStore with the same key. These on the subtree
  // would need to just do `const storeB = useClosestStore('b-store')`
  // because if there's a second argument, it would initialize a new store.
  //
  // useGlobalStore works the same, but it is a global store.
  // It should be initialized as
  // higher on the component tree as possible.
  const storeB = useClosestStore('b-store', () => ({
    test$: 'hey',
    otherTest$: 'ho'
  }))

  // Destructuring the store's signals and computeds
  // won't make them unreactive in the process.
  const { signalExample$, anotherSignalExample$ } = storeA

  useTask(({ track, cleanup }) => {
    // The cleanup function runs before the task re-runs
    cleanup(() => { console.log('Cleanup test') })
    // This task will re-run when storeB.test$() or storeB.otherTest$()
    // changes
    const test = track(() => storeB.test$() + storeB.otherTest$())
    console.log(test) // Should print 'heyho'

    // This is an example of setting a signal's value.
    // If the function has an argument, it updates the signal's value,
    // even if the argument is a literal undefined.
    signalExample$(new Date().toISOString())

    // One can lazily set a signal value if passing a function as argument.
    anotherSignalExample$(v => v + ' world')
  })

  // It doesn't need a react-like fragment component
  // to group multiple elements.
  //
  // It uses this.h tagged template string instead of JSX.
  //
  // When rendering a svg, it would need the this.s one instead.
  return this.h`
    <button
      onclick=${
        // Note that the event attribute (e.g. onclick) is all lowercase,
        // like regular HTML, instead of camelcase like with React
        storeA.otherCallback
      }
      type='button'
    >Click me</button>
    ${storeA.names.map(name =>
      // We have to pass the key both to the h function and to the wrapper component
      // to account for 'thenameisf' different versions
      //
      // The <f-to-signals> component is optional, but it is needed if we
      // want to inline-transform non-reactive props into computed props
      // by listing the non-reactive prop names on the `props.from` array
      // (or to a signal if the props.from array's item is an array
      // with name pair of a non-reactive getter and setter insted of just a
      // getter name).
      //
      // For example, below we are making available props.name$ to the <child-item>
      // component.
      //
      // Here we also show that `props` is a special HTML attribute that is passed
      // to a custom element, then to be retrieved by it by calling this.props.
      //
      // Important: make sure to use <f-to-signals> to turn non-reactive variables
      // into reactive props, to keep consistent use of signals/computed where
      // appropriate, i.e., excluding callback props (functions), that aren't
      // expected to be reactive.
      this.h({ key: name })`
        <f-to-signals
          key=${name}
          props=${{
            from: ['name', ['selectedName', 'setSelectedName']],
            name, // this becomes name$
            notTransformedToSignalNorToComputed: 'example', // this will be passed down as-is
            render: props => this.h`<child-item props=${props} ></child-item>`
          }}
        />
      `
    )}
  `
})

f(function childItem () {
  const storeB = useClosestStore('b-store')

  // Look at how we declared a dynamic class.
  // It could also be this.h`<span class=${`tag-part ${i === 0 ? 'tag-key' : 'tag-value'}`}>`
  // while this wouldn't work this.h`<span class='tag-part ${i === 0 ? 'tag-key' : 'tag-value'}'>`
  return this.h`
    <div
      class=${{
        // the 'class-example' class won't be included if shouldHaveThisClass() returns false
        'class-example': shouldHaveThisClass()
      }}
    >${storeB.test$()}: ${this.props.name$()}</div>
    <styling-example />
    <conditional-rendering-example />
  `
})

f(function stylingExample () {
  const { id$ } = useStore({
    id$: ('a' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2))
    visibility$: 'hidden'
  })
  // Note that the framework needs the style tag content, if including dynamic css, to be already a string, so
  // the following wouldn't work: this.h`<div id=${id$()}><style>#${id$()} { visibility: ${visibility$()}; }</style></div>`,
  // i.e., enclose it with <style>${ ... }</style>
  return this.h`
    <div
      class=${{
        // the 'class-example' class won't be included if shouldHaveThisClass() returns false
        'class-example': shouldHaveThisClass()
      }}
    >${storeB.test$()}: ${this.props.name$()}</div>
    <div
      id=${id$()}
    >
      <style>${
        /* Look how we enclose it with <style>${ ... }</style> */
        #${id$()} { visibility: ${visibility$()}; }
      }</style>
      <span>Test</span>
    </div>
  `
})

f(function conditionalRenderingExample () {
  if (!this.props.shouldRender) return

  // Conditional rendering should fallback to an empty string, like (test || '')
  // to avoid render an unexpected 'false' string
  this.h`${(this.props.test || '') && <div>hello</div>}
})
```
