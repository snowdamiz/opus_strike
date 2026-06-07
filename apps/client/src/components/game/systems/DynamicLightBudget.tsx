import { forwardRef, useCallback, useEffect, useRef, type ForwardedRef } from 'react';
import { useFrame, type ThreeElements } from '@react-three/fiber';
import * as THREE from 'three';
import { registerFrameSystem } from '../../../utils/perfMarks';

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

export function DynamicLightBudgetSystem({ maxLights }: { maxLights: number }) {
  const accumulatorRef = useRef(0);
  const rankedRef = useRef<RankedLight[]>([]);
  const selectedRef = useRef(new Set<BudgetedLightRecord>());

  useEffect(() => registerFrameSystem('dynamic-light-budget'), []);

  useFrame(({ camera }, delta) => {
    accumulatorRef.current += delta;
    if (accumulatorRef.current < 0.08) return;
    accumulatorRef.current = 0;

    const ranked = rankedRef.current;
    const selected = selectedRef.current;
    ranked.length = 0;
    selected.clear();

    for (const record of budgetedLights) {
      const light = record.lightRef.current;
      if (!light || !light.parent || light.intensity <= 0) {
        if (light) light.visible = false;
        continue;
      }

      light.getWorldPosition(worldPosition);
      const radius = Math.max(1, record.radius || light.distance || 1);
      const distancePenalty = camera.position.distanceToSquared(worldPosition) / (radius * radius);
      ranked.push({
        record,
        score: record.priority * 1000 + light.intensity * 10 - distancePenalty * 140,
      });
    }

    ranked.sort((a, b) => b.score - a.score);

    for (let i = 0; i < Math.min(maxLights, ranked.length); i++) {
      selected.add(ranked[i].record);
    }

    for (const record of budgetedLights) {
      const light = record.lightRef.current;
      if (light) {
        light.visible = selected.has(record);
      }
    }
  });

  return null;
}
