/**
 * TronMap - Loads and renders the Tron.glb map model
 *
 * This component loads the external GLB map file and sets up
 * the visual representation of the Tron-themed CTF arena.
 * Also initializes physics colliders from GLB collision properties.
 */

import { useGLTF } from '@react-three/drei';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { isPhysicsReady, loadMapColliders, areMapCollidersLoaded } from '../../../../hooks/usePhysics';

// Preload the map for faster loading
useGLTF.preload('/maps/Tron.glb');

export function TronMap() {
  const { scene } = useGLTF('/maps/Tron.glb');
  const collidersLoadedRef = useRef(false);

  // Clone the scene to avoid mutating the cached version
  const clonedScene = useMemo(() => scene.clone(true), [scene]);

  // Process materials to ensure textures display correctly
  useEffect(() => {
    clonedScene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        // Enable shadows
        child.castShadow = true;
        child.receiveShadow = true;

        // Process materials
        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material];

        materials.forEach((material) => {
          if (material instanceof THREE.MeshStandardMaterial ||
              material instanceof THREE.MeshPhysicalMaterial) {
            // Ensure proper texture encoding for color maps
            if (material.map) {
              material.map.colorSpace = THREE.SRGBColorSpace;
              material.map.needsUpdate = true;
            }
            if (material.emissiveMap) {
              material.emissiveMap.colorSpace = THREE.SRGBColorSpace;
              material.emissiveMap.needsUpdate = true;
            }
            // Keep other maps in linear space (normal, roughness, metalness, ao)
            material.needsUpdate = true;
          }
        });
      }
    });
  }, [clonedScene]);

  // Load physics colliders from GLB collision properties
  useEffect(() => {
    if (collidersLoadedRef.current || areMapCollidersLoaded()) {
      return;
    }

    // Wait for physics to be ready, then load colliders
    const loadColliders = () => {
      if (isPhysicsReady() && !collidersLoadedRef.current) {
        // Use the original scene (not cloned) to get userData from GLB
        const success = loadMapColliders(scene);
        if (success) {
          collidersLoadedRef.current = true;
        }
      }
    };

    // Try immediately
    loadColliders();

    // If physics isn't ready yet, poll until it is
    if (!collidersLoadedRef.current) {
      const interval = setInterval(() => {
        loadColliders();
        if (collidersLoadedRef.current) {
          clearInterval(interval);
        }
      }, 100);

      return () => clearInterval(interval);
    }
  }, [scene]);

  return (
    <group name="tron-map">
      <primitive object={clonedScene} />
    </group>
  );
}
