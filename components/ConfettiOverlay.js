import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Dimensions } from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PARTICLE_COUNT = 50;
const DURATION_MS = 2200;
const COLORS = ['#E94560', '#FF6B6B', '#FFE66D', '#4ECDC4', '#A8E6CF', '#95E1D3', '#F38181'];

function useConfetti() {
  const particles = useRef(
    Array.from({ length: PARTICLE_COUNT }, () => {
      const translateY = new Animated.Value(-20);
      const opacity = new Animated.Value(1);
      const rotate = new Animated.Value(0);
      return {
        translateX: Math.random() * SCREEN_WIDTH,
        translateY,
        opacity,
        rotate,
        size: 6 + Math.random() * 8,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        delay: Math.random() * 400,
        duration: DURATION_MS + Math.random() * 800,
      };
    }),
  ).current;

  useEffect(() => {
    const animations = particles.map((p) =>
      Animated.parallel([
        Animated.timing(p.translateY, {
          toValue: 820,
          duration: p.duration,
          delay: p.delay,
          useNativeDriver: true,
        }),
        Animated.timing(p.opacity, {
          toValue: 0,
          duration: p.duration,
          delay: p.delay + p.duration * 0.6,
          useNativeDriver: true,
        }),
        Animated.timing(p.rotate, {
          toValue: 1,
          duration: p.duration,
          delay: p.delay,
          useNativeDriver: true,
        }),
      ]),
    );
    Animated.stagger(0, animations).start();
  }, [particles]);

  return particles;
}

export default function ConfettiOverlay() {
  const particles = useConfetti();

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {particles.map((p, i) => (
        <Animated.View
          key={i}
          style={[
            styles.particle,
            {
              width: p.size,
              height: p.size,
              borderRadius: p.size / 2,
              backgroundColor: p.color,
              opacity: p.opacity,
              transform: [
                { translateX: p.translateX },
                { translateY: p.translateY },
                {
                  rotate: p.rotate.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0deg', '720deg'],
                  }),
                },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  particle: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
});
