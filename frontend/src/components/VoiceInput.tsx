import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Platform,
  ActivityIndicator,
} from 'react-native';
import * as Speech from 'expo-speech';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/colors';

interface VoiceInputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  editable?: boolean;
}

export default function VoiceInput({
  value,
  onChangeText,
  placeholder = 'Tap microphone to speak...',
  editable = true,
}: VoiceInputProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [hasPermission, setHasPermission] = useState(false);

  useEffect(() => {
    checkPermissions();
    return () => {
      if (recording) {
        recording.stopAndUnloadAsync();
      }
    };
  }, []);

  const checkPermissions = async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      setHasPermission(status === 'granted');
    } catch (error) {
      console.log('Error checking audio permissions:', error);
    }
  };

  const startRecording = async () => {
    if (!hasPermission) {
      await checkPermissions();
      return;
    }

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording: newRecording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecording(newRecording);
      setIsRecording(true);
    } catch (error) {
      console.log('Error starting recording:', error);
    }
  };

  const stopRecording = async () => {
    if (!recording) return;

    try {
      setIsRecording(false);
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);

      // Note: In a real app, you would send this audio to a speech-to-text service
      // For now, we'll show a placeholder message
      if (uri) {
        // Placeholder - in production, send to speech-to-text API
        const timestamp = new Date().toLocaleTimeString();
        const newText = value 
          ? `${value}\n[Voice note recorded at ${timestamp}]` 
          : `[Voice note recorded at ${timestamp}]`;
        onChangeText(newText);
      }
    } catch (error) {
      console.log('Error stopping recording:', error);
    }
  };

  const handleMicPress = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textMuted}
        multiline
        editable={editable}
      />
      {editable && (
        <TouchableOpacity
          style={[
            styles.micButton,
            isRecording && styles.micButtonRecording,
          ]}
          onPress={handleMicPress}
        >
          {isRecording ? (
            <View style={styles.recordingIndicator}>
              <View style={styles.recordingDot} />
            </View>
          ) : (
            <Ionicons name="mic" size={22} color={COLORS.text} />
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 12,
    overflow: 'hidden',
  },
  input: {
    flex: 1,
    padding: 14,
    fontSize: 15,
    color: COLORS.text,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  micButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    margin: 8,
  },
  micButtonRecording: {
    backgroundColor: COLORS.danger,
  },
  recordingIndicator: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  recordingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.text,
  },
});
