import { forwardRef, useCallback, useEffect, useRef, type ForwardedRef, type MutableRefObject } from 'react';
import { useFrame, type ThreeElements } from '@react-three/fiber';
import * as THREE from 'three';
import {
  MOVEMENT_DIAGNOSTICS_ENABLED,
  measureFrameWork,
  recordDynamicLightDiagnostics,
} from '../../../movement/networkDiagnostics';

type PointLightProps = ThreeElements['pointLight'];

type BudgetedLightRecord = {
  id: number;
  lightRef: { current: THREE.PointLight | null };
  priority: number;
  radius: number;
};

export type BudgetedPointLightProps = PointLightProps & {
  budgetPriority?: number;
  budgetRadius?: number;
};

const budgetedLights = new Set<BudgetedLightRecord>();
const worldPosition = new THREE.Vector3();
let nextLightId = 1;

function setLightVisible(light: THREE.PointLight, visible: boolean): void {
  if (light.visible !== visible) {
    light.visible = visible;
  }
}

function assignForwardedRef(ref: ForwardedRef<THREE.PointLight>, value: THREE.PointLight | null): void {
  if (typeof ref === 'function') {
    ref(value);
    return;
  }

  if (ref) {
    ref.current = value;
  }
}

export const BudgetedPointLight = forwardRef<THREE.PointLight, BudgetedPointLightProps>(
  function BudgetedPointLight(
    {
      budgetPriority = 1,
      budgetRadius,
      ...props
    },
    forwardedRef
  ) {
    const lightRef = useRef<THREE.PointLight | null>(null);
    const recordRef = useRef<BudgetedLightRecord>({
      id: nextLightId++,
      lightRef,
      priority: budgetPriority,
      radius: budgetRadius ?? 1,
    });

    recordRef.current.priority = budgetPriority;

    const setRefs = useCallback((light: THREE.PointLight | null) => {
      lightRef.current = light;
      assignForwardedRef(forwardedRef, light);
    }, [forwardedRef]);

    useEffect(() => {
      const record = recordRef.current;
      budgetedLights.add(record);
      return () => {
        if (record.lightRef.current) {
          record.lightRef.current.visible = true;
        }
        budgetedLights.delete(record);
      };
    }, []);

    useEffect(() => {
      const light = lightRef.current;
      recordRef.current.radius = budgetRadius ?? light?.distance ?? 1;
    }, [budgetRadius, props.distance]);

    return <pointLight ref={setRefs} {...props} />;
  }
);

interface RankedLight {
  record: BudgetedLightRecord;
  score: number;
}

function insertRankedLight(
  ranked: RankedLight[],
  pool: RankedLight[],
  record: BudgetedLightRecord,
  score: number,
  limit: number
): void {
  if (limit <= 0) return;

  let insertIndex = ranked.length;
  let entry: RankedLight;
  if (insertIndex < limit) {
    entry = pool[insertIndex];
    if (!entry) {
      entry = { record, score };
      pool[insertIndex] = entry;
    } else {
      entry.record = record;
      entry.score = score;
    }
    ranked.push(entry);
  } else {
    insertIndex = limit - 1;
    entry = ranked[insertIndex];
    if (!entry || score <= entry.score) return;
    entry.record = record;
    entry.score = score;
  }

  while (insertIndex > 0 && ranked[insertIndex - 1].score < score) {
    ranked[insertIndex] = ranked[insertIndex - 1];
    insertIndex--;
  }
  ranked[insertIndex] = entry;
}

function recordDynamicLightBudgetDiagnostics(
  registered: number,
  activeCandidates: number,
  enabled: number,
  budget: number
): void {
  if (!MOVEMENT_DIAGNOSTICS_ENABLED) return;
  recordDynamicLightDiagnostics({
    registered,
    activeCandidates,
    enabled,
    budget,
  });
}

function updateDynamicLightBudget(
  camera: THREE.Camera,
  delta: number,
  maxLights: number,
  accumulatorRef: MutableRefObject<number>,
  rankedRef: MutableRefObject<RankedLight[]>,
  rankedPoolRef: MutableRefObject<RankedLight[]>
): void {
  accumulatorRef.current += delta;
  if (accumulatorRef.current < 0.08) return;
  accumulatorRef.current = 0;

  const lightLimit = Math.max(0, Math.floor(maxLights));
  if (budgetedLights.size === 0) {
    rankedRef.current.length = 0;
    recordDynamicLightBudgetDiagnostics(0, 0, 0, lightLimit);
    return;
  }

  const ranked = rankedRef.current;
  const rankedPool = rankedPoolRef.current;
  ranked.length = 0;

  if (lightLimit <= 0) {
    let activeCandidates = 0;
    for (const record of budgetedLights) {
      const light = record.lightRef.current;
      if (light?.parent && light.intensity > 0) activeCandidates++;
      if (light) setLightVisible(light, false);
    }
    recordDynamicLightBudgetDiagnostics(budgetedLights.size, activeCandidates, 0, lightLimit);
    return;
  }

  if (lightLimit >= budgetedLights.size) {
    let activeCandidates = 0;
    let enabled = 0;
    for (const record of budgetedLights) {
      const light = record.lightRef.current;
      const active = Boolean(light?.parent && light.intensity > 0);
      if (active) activeCandidates++;
      if (light) {
        setLightVisible(light, active);
        if (active) enabled++;
      }
    }
    recordDynamicLightBudgetDiagnostics(budgetedLights.size, activeCandidates, enabled, lightLimit);
    return;
  }

  let activeCandidates = 0;
  for (const record of budgetedLights) {
    const light = record.lightRef.current;
    if (!light || !light.parent || light.intensity <= 0) {
      if (light) setLightVisible(light, false);
      continue;
    }

    activeCandidates++;
    setLightVisible(light, false);
    light.getWorldPosition(worldPosition);
    const radius = Math.max(1, record.radius || light.distance || 1);
    const distancePenalty = camera.position.distanceToSquared(worldPosition) / (radius * radius);
    insertRankedLight(
      ranked,
      rankedPool,
      record,
      record.priority * 1000 + light.intensity * 10 - distancePenalty * 140,
      lightLimit
    );
  }

  for (let i = 0; i < ranked.length; i++) {
    const light = ranked[i].record.lightRef.current;
    if (light) {
      setLightVisible(light, true);
    }
  }
  recordDynamicLightBudgetDiagnostics(budgetedLights.size, activeCandidates, ranked.length, lightLimit);
}

export function DynamicLightBudgetSystem({ maxLights }: { maxLights: number }) {
  const accumulatorRef = useRef(0);
  const rankedRef = useRef<RankedLight[]>([]);
  const rankedPoolRef = useRef<RankedLight[]>([]);

  useFrame(({ camera }, delta) => {
    if (MOVEMENT_DIAGNOSTICS_ENABLED) {
      measureFrameWork('frame.dynamicLights', () => (
        updateDynamicLightBudget(camera, delta, maxLights, accumulatorRef, rankedRef, rankedPoolRef)
      ));
    } else {
      updateDynamicLightBudget(camera, delta, maxLights, accumulatorRef, rankedRef, rankedPoolRef);
    }
  });

  return null;
}
