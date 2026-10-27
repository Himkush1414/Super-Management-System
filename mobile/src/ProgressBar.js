// @ts-check
import { useEffect, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

/** Below this a navigation is instant enough that a bar would only flicker. */
const SHOW_AFTER_MS = 150;

/**
 * A thin native bar across the top of the page while a page loads: a
 * short segment sliding across, like a native app's indeterminate bar.
 * @param {{ active: boolean, color: string }} props
 */
export function ProgressBar({ active, color }) {
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(0);
  // created once; Animated values are driven natively, not read in render
  const [x] = useState(() => new Animated.Value(0));
  const [opacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!active) {
      Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => setVisible(false));
      return;
    }
    const t = setTimeout(() => {
      setVisible(true);
      Animated.timing(opacity, { toValue: 1, duration: 120, useNativeDriver: true }).start();
    }, SHOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [active, opacity]);

  useEffect(() => {
    if (!visible || !width) return;
    x.setValue(0);
    const loop = Animated.loop(
      Animated.timing(x, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, width, x]);

  const segment = Math.max(80, width * 0.35);
  return (
    <View
      pointerEvents="none"
      style={styles.track}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {visible ? (
        <Animated.View
          style={[
            styles.bar,
            {
              width: segment,
              backgroundColor: color,
              opacity,
              transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [-segment, width] }) }],
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { position: "absolute", top: 0, left: 0, right: 0, height: 3, overflow: "hidden", zIndex: 10 },
  bar: { height: 3, borderRadius: 2 },
});
