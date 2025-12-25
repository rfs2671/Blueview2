import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  PanResponder,
  Dimensions,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import ViewShot from 'react-native-view-shot';
import { COLORS } from '../constants/colors';

interface SignaturePadProps {
  onSave: (signature: string) => void;
  onCancel: () => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PAD_WIDTH = SCREEN_WIDTH - 40;
const PAD_HEIGHT = 200;

export default function SignaturePad({ onSave, onCancel }: SignaturePadProps) {
  const [paths, setPaths] = useState<string[]>([]);
  const [currentPath, setCurrentPath] = useState<string>('');
  const viewShotRef = useRef<ViewShot>(null);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        setCurrentPath(`M${locationX},${locationY}`);
      },
      onPanResponderMove: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        setCurrentPath((prev) => `${prev} L${locationX},${locationY}`);
      },
      onPanResponderRelease: () => {
        if (currentPath) {
          setPaths((prev) => [...prev, currentPath]);
          setCurrentPath('');
        }
      },
    })
  ).current;

  const handleClear = () => {
    setPaths([]);
    setCurrentPath('');
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const handleSave = async () => {
    if (paths.length === 0) {
      return;
    }

    try {
      if (viewShotRef.current?.capture) {
        const uri = await viewShotRef.current.capture();
        onSave(uri);
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      }
    } catch (error) {
      console.log('Error capturing signature:', error);
    }
  };

  return (
    <View style={styles.overlay}>
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Draw Your Signature</Text>
            <TouchableOpacity onPress={onCancel}>
              <Ionicons name="close" size={28} color={COLORS.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.padContainer}>
            <ViewShot
              ref={viewShotRef}
              options={{ format: 'png', quality: 1, result: 'base64' }}
            >
              <View
                style={styles.pad}
                {...panResponder.panHandlers}
              >
                <Svg width={PAD_WIDTH} height={PAD_HEIGHT}>
                  {paths.map((path, index) => (
                    <Path
                      key={index}
                      d={path}
                      stroke="#000"
                      strokeWidth={3}
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                  {currentPath && (
                    <Path
                      d={currentPath}
                      stroke="#000"
                      strokeWidth={3}
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                </Svg>
                <View style={styles.signatureLine} />
              </View>
            </ViewShot>
          </View>

          <Text style={styles.instruction}>
            Sign above the line using your finger
          </Text>

          <View style={styles.buttons}>
            <TouchableOpacity
              style={[styles.button, styles.clearButton]}
              onPress={handleClear}
            >
              <Ionicons name="refresh" size={20} color={COLORS.text} />
              <Text style={styles.buttonText}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.button,
                styles.saveButton,
                paths.length === 0 && styles.buttonDisabled,
              ]}
              onPress={handleSave}
              disabled={paths.length === 0}
            >
              <Ionicons name="checkmark" size={20} color={COLORS.text} />
              <Text style={styles.buttonText}>Save Signature</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    zIndex: 1000,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
  },
  content: {
    marginHorizontal: 20,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
  },
  padContainer: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  pad: {
    width: PAD_WIDTH,
    height: PAD_HEIGHT,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
  },
  signatureLine: {
    position: 'absolute',
    bottom: 50,
    left: 20,
    right: 20,
    height: 1,
    backgroundColor: '#CCCCCC',
  },
  instruction: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 20,
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  clearButton: {
    backgroundColor: COLORS.surfaceLight,
  },
  saveButton: {
    backgroundColor: COLORS.primary,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
});
