import { forwardRef, useCallback, useEffect, useRef, type ForwardedRef, type MutableRefObject } from 'react';
import { useFrame, type ThreeElements } from '@react-three/fiber';
import * as THREE from 'three';

type PointLightProps = ThreeElements['pointLight'];

type BudgetedLightRecord = {
  id: number;
  lightRef: { current: THREE.PointLight | null };
  priority: number;
  radius: number;
  selectedPass: number;
};

export type BudgetedPointLightProps = PointLightProps & {
  budgetPriority?: number;
  budgetRadius?: number;
};

const budgetedLights = new Set<BudgetedLightRecord>();
const worldPosition = new THREE.Vector3();
let nextLightId = 1;
let lightBudgetPassId = 1;

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
      selectedPass: 0,
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
    return;
  }

  const ranked = rankedRef.current;
  const rankedPool = rankedPoolRef.current;
  ranked.length = 0;

  if (lightLimit <= 0) {
    for (const record of budgetedLights) {
      const light = record.lightRef.current;
      if (light) setLightVisible(light, false);
    }
    return;
  }

  if (lightLimit >= budgetedLights.size) {
    for (const record of budgetedLights) {
      const light = record.lightRef.current;
      const active = Boolean(light?.parent && light.intensity > 0);
      if (light) {
        setLightVisible(light, active);
      }
    }
    return;
  }

  const passId = lightBudgetPassId++;
  for (const record of budgetedLights) {
    const light = record.lightRef.current;
    if (!light || !light.parent || light.intensity <= 0) {
      continue;
    }

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
    ranked[i].record.selectedPass = passId;
  }

  for (const record of budgetedLights) {
    const light = record.lightRef.current;
    if (light) {
      setLightVisible(light, record.selectedPass === passId);
    }
  }
}

export function DynamicLightBudgetSystem({ maxLights }: { maxLights: number }) {
  const accumulatorRef = useRef(0);
  const rankedRef = useRef<RankedLight[]>([]);
  const rankedPoolRef = useRef<RankedLight[]>([]);

  useFrame(({ camera }, delta) => {
    updateDynamicLightBudget(camera, delta, maxLights, accumulatorRef, rankedRef, rankedPoolRef);
  });

  return null;
}
