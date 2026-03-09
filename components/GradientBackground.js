import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const COLORS = ['#1A1A2E', '#16213E', '#0F172A'];

export default function GradientBackground({ children, style }) {
  return (
    <View style={[StyleSheet.absoluteFill, style]}>
      <LinearGradient
        colors={COLORS}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />
      {children}
    </View>
  );
}
