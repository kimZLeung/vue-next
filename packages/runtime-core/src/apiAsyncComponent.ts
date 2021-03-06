import {
  PublicAPIComponent,
  Component,
  currentSuspense,
  currentInstance,
  ComponentInternalInstance,
  isInSSRComponentSetup
} from './component'
import { isFunction, isObject, EMPTY_OBJ, NO } from '@vue/shared'
import { ComponentPublicInstance } from './componentProxy'
import { createVNode } from './vnode'
import { defineComponent } from './apiDefineComponent'
import { warn } from './warning'
import { ref } from '@vue/reactivity'
import { handleError, ErrorCodes } from './errorHandling'

export type AsyncComponentResolveResult<T = PublicAPIComponent> =
  | T
  | { default: T } // es modules

export type AsyncComponentLoader<T = any> = () => Promise<
  AsyncComponentResolveResult<T>
>

export interface AsyncComponentOptions<T = any> {
  loader: AsyncComponentLoader<T>
  loadingComponent?: PublicAPIComponent
  errorComponent?: PublicAPIComponent
  delay?: number
  timeout?: number
  retryWhen?: (error: Error) => any
  maxRetries?: number
  suspensible?: boolean
}

export function defineAsyncComponent<
  T extends PublicAPIComponent = { new (): ComponentPublicInstance }
>(source: AsyncComponentLoader<T> | AsyncComponentOptions<T>): T {
  if (isFunction(source)) {
    source = { loader: source }
  }

  const {
    loader,
    loadingComponent: loadingComponent,
    errorComponent: errorComponent,
    delay = 200,
    timeout, // undefined = never times out
    retryWhen = NO,
    maxRetries = 3,
    suspensible = true
  } = source

  let pendingRequest: Promise<Component> | null = null
  let resolvedComp: Component | undefined

  let retries = 0
  const retry = (error?: unknown) => {
    retries++
    pendingRequest = null
    return load()
  }

  const load = (): Promise<Component> => {
    let thisRequest: Promise<Component>
    return (
      pendingRequest ||
      (thisRequest = pendingRequest = loader()
        .catch(err => {
          err = err instanceof Error ? err : new Error(String(err))
          if (retryWhen(err) && retries < maxRetries) {
            return retry(err)
          } else {
            throw err
          }
        })
        .then((comp: any) => {
          if (thisRequest !== pendingRequest && pendingRequest) {
            return pendingRequest
          }
          if (__DEV__ && !comp) {
            warn(
              `Async component loader resolved to undefined. ` +
                `If you are using retry(), make sure to return its return value.`
            )
          }
          // interop module default
          if (
            comp &&
            (comp.__esModule || comp[Symbol.toStringTag] === 'Module')
          ) {
            comp = comp.default
          }
          if (__DEV__ && comp && !isObject(comp) && !isFunction(comp)) {
            throw new Error(`Invalid async component load result: ${comp}`)
          }
          resolvedComp = comp
          return comp
        }))
    )
  }

  return defineComponent({
    __asyncLoader: load,
    name: 'AsyncComponentWrapper',
    setup() {
      const instance = currentInstance!

      // already resolved
      if (resolvedComp) {
        return () => createInnerComp(resolvedComp!, instance)
      }

      const onError = (err: Error) => {
        pendingRequest = null
        handleError(err, instance, ErrorCodes.ASYNC_COMPONENT_LOADER)
      }

      // suspense-controlled or SSR.
      if (
        (__FEATURE_SUSPENSE__ && suspensible && currentSuspense) ||
        (__NODE_JS__ && isInSSRComponentSetup)
      ) {
        return load()
          .then(comp => {
            return () => createInnerComp(comp, instance)
          })
          .catch(err => {
            onError(err)
            return () =>
              errorComponent
                ? createVNode(errorComponent as Component, { error: err })
                : null
          })
      }

      const loaded = ref(false)
      const error = ref()
      const delayed = ref(!!delay)

      if (delay) {
        setTimeout(() => {
          delayed.value = false
        }, delay)
      }

      if (timeout != null) {
        setTimeout(() => {
          if (!loaded.value) {
            const err = new Error(
              `Async component timed out after ${timeout}ms.`
            )
            onError(err)
            error.value = err
          }
        }, timeout)
      }

      load()
        .then(() => {
          loaded.value = true
        })
        .catch(err => {
          onError(err)
          error.value = err
        })

      return () => {
        if (loaded.value && resolvedComp) {
          return createInnerComp(resolvedComp, instance)
        } else if (error.value && errorComponent) {
          return createVNode(errorComponent as Component, {
            error: error.value
          })
        } else if (loadingComponent && !delayed.value) {
          return createVNode(loadingComponent as Component)
        }
      }
    }
  }) as any
}

function createInnerComp(
  comp: Component,
  { props, slots }: ComponentInternalInstance
) {
  return createVNode(
    comp,
    props === EMPTY_OBJ ? null : props,
    slots === EMPTY_OBJ ? null : slots
  )
}
