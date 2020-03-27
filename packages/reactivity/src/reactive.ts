import { isObject, toRawType } from '@vue/shared'
import {
  mutableHandlers,
  readonlyHandlers,
  shallowReadonlyHandlers,
  shallowReactiveHandlers
} from './baseHandlers'
import {
  mutableCollectionHandlers,
  readonlyCollectionHandlers
} from './collectionHandlers'
import { UnwrapRef, Ref, isRef } from './ref'
import { makeMap } from '@vue/shared'

// WeakMaps that store {raw <-> observed} pairs.
const rawToReactive = new WeakMap<any, any>() // 以原对象为键，Proxy对象为值
const reactiveToRaw = new WeakMap<any, any>() // 以Proxy对象为键，原对象为值（判断isReactive）
const rawToReadonly = new WeakMap<any, any>() // 以原对象为键，Proxy对象为值
const readonlyToRaw = new WeakMap<any, any>() // 以Proxy对象为键，原对象为值

// WeakSets for values that are marked readonly or non-reactive during
// observable creation.
const readonlyValues = new WeakSet<any>()
const nonReactiveValues = new WeakSet<any>()

const collectionTypes = new Set<Function>([Set, Map, WeakMap, WeakSet])
const isObservableType = /*#__PURE__*/ makeMap(
  'Object,Array,Map,Set,WeakMap,WeakSet'
)

const canObserve = (value: any): boolean => {
  return (
    !value._isVue &&
    !value._isVNode &&
    isObservableType(toRawType(value)) &&
    !nonReactiveValues.has(value) &&
    !Object.isFrozen(value)
  )
}

// only unwrap nested ref
type UnwrapNestedRefs<T> = T extends Ref ? T : UnwrapRef<T>

export function reactive<T extends object>(target: T): UnwrapNestedRefs<T>
export function reactive(target: object) {
  // if trying to observe a readonly proxy, return the readonly version.
  if (readonlyToRaw.has(target)) {
    return target
  }
  // target is explicitly marked as readonly by user
  if (readonlyValues.has(target)) {
    return readonly(target)
  }
  if (isRef(target)) {
    return target
  }
  return createReactiveObject(
    target,
    rawToReactive,
    reactiveToRaw,
    mutableHandlers,
    mutableCollectionHandlers
  )
}

export function readonly<T extends object>(
  target: T
): Readonly<UnwrapNestedRefs<T>> {
  // value is a mutable observable, retrieve its original and return
  // a readonly version.
  if (reactiveToRaw.has(target)) {
    target = reactiveToRaw.get(target)
  }
  return createReactiveObject(
    target,
    rawToReadonly,
    readonlyToRaw,
    readonlyHandlers,
    readonlyCollectionHandlers
  )
}

// Return a reactive-copy of the original object, where only the root level
// properties are readonly, and does NOT unwrap refs nor recursively convert
// returned properties.
// This is used for creating the props proxy object for stateful components.
export function shallowReadonly<T extends object>(
  target: T
): Readonly<{ [K in keyof T]: UnwrapNestedRefs<T[K]> }> {
  return createReactiveObject(
    target,
    rawToReadonly,
    readonlyToRaw,
    shallowReadonlyHandlers,
    readonlyCollectionHandlers
  )
}

// Return a reactive-copy of the original object, where only the root level
// properties are reactive, and does NOT unwrap refs nor recursively convert
// returned properties.
export function shallowReactive<T extends object>(target: T): T {
  return createReactiveObject(
    target,
    rawToReactive,
    reactiveToRaw,
    shallowReactiveHandlers,
    mutableCollectionHandlers
  )
}

/**
 * 通过这个方法传入raw原始数据，挂上Proxy钩子返回响应式数据
 *
 * 挂载上hook后，通过effect提供的track方法收集依赖到targetMap中
 * 依赖数据结构: (ReactiveEffect)这个接口是函数类型
 *    targetMap: {
 *      target: {
 *        dep: Set[]<ReactiveEffect>
 *      }
 *    }
 *
 * 然后因为Proxy钩子的存在，调用返回的响应式数据的时候通过set方法，可调用
 * effect中提供的trigger方法进行调用对应 ReactiveEffect 方法，也就是调用者传入的回调。
 *
 */
function createReactiveObject(
  target: unknown,
  toProxy: WeakMap<any, any>,
  toRaw: WeakMap<any, any>,
  baseHandlers: ProxyHandler<any>,
  collectionHandlers: ProxyHandler<any>
) {
  if (!isObject(target)) {
    if (__DEV__) {
      console.warn(`value cannot be made reactive: ${String(target)}`)
    }
    return target
  }
  // target already has corresponding Proxy
  let observed = toProxy.get(target)
  if (observed !== void 0) {
    return observed
  }
  // target is already a Proxy
  if (toRaw.has(target)) {
    return target
  }
  // only a whitelist of value types can be observed.
  if (!canObserve(target)) {
    return target
  }
  // 判断target的构造器是否属于 Set Map WeakSet WeakMap 中的一个
  // 如果是这种集合。则使用collectionHandlers 处理Proxy：因为这类集合不能直接使用Proxy和Reflect进行代理
  // 然后保存到全局的targetMap上时就是新创建的普通对象，并不是原本的集合，调用返回的 observed 对象的方法也是Vue给实现的，可以触发trigger
  // 如果不是直接使用 baseHandlers 就可以
  const handlers = collectionTypes.has(target.constructor)
    ? collectionHandlers
    : baseHandlers
  observed = new Proxy(target, handlers)
  toProxy.set(target, observed)
  toRaw.set(observed, target)
  return observed
}

export function isReactive(value: unknown): boolean {
  return reactiveToRaw.has(value) || readonlyToRaw.has(value)
}

export function isReadonly(value: unknown): boolean {
  return readonlyToRaw.has(value)
}

export function toRaw<T>(observed: T): T {
  return reactiveToRaw.get(observed) || readonlyToRaw.get(observed) || observed
}

export function markReadonly<T>(value: T): T {
  readonlyValues.add(value)
  return value
}

export function markNonReactive<T>(value: T): T {
  nonReactiveValues.add(value)
  return value
}
