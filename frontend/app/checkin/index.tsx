import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';

const COLORS = {
  background: '#0A1929',
  surface: '#132F4C',
  surfaceLight: '#1E3A5F',
  primary: '#FF6B00',
  secondary: '#00D4FF',
  success: '#4CAF50',
  warning: '#FFB800',
  danger: '#FF4444',
  text: '#FFFFFF',
  textSecondary: '#B0BEC5',
  border: '#2D4A6F',
};

interface CheckinResult {
  token: string;
  worker: {
    id: string;
    name: string;
    phone: string;
    trade: string;
  };
  checkin_time: string;
}

export default function CheckInScreen() {
  const { token, project } = useLocalSearchParams<{ token: string; project: string }>();
  const router = useRouter();
  
  const [status, setStatus] = useState<'loading' | 'ready' | 'checking' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [checkinResult, setCheckinResult] = useState<CheckinResult | null>(null);
  
  const API_URL = Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL || 
    process.env.EXPO_PUBLIC_BACKEND_URL || '';

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMessage('Invalid check-in link. Please use the link from your SMS.');
      return;
    }
    
    requestLocationPermission();
  }, [token]);

  const requestLocationPermission = async () => {
    try {
      const { status: permStatus } = await Location.requestForegroundPermissionsAsync();
      
      if (permStatus !== 'granted') {
        setStatus('error');
        setErrorMessage('Location permission is required to check in. Please enable location access and try again.');
        return;
      }
      
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      
      setLocation({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      setStatus('ready');
      
    } catch (error) {
      setStatus('error');
      setErrorMessage('Could not get your location. Please ensure GPS is enabled and try again.');
    }
  };

  const handleCheckin = async () => {
    if (!location || !token) return;
    
    setStatus('checking');
    
    try {
      const response = await fetch(`${API_URL}/api/checkin/fast-login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token: token,
          latitude: location.latitude,
          longitude: location.longitude,
        }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Check-in failed');
      }
      
      const result: CheckinResult = await response.json();
      setCheckinResult(result);
      setStatus('success');
      
    } catch (error: any) {
      setStatus('error');
      setErrorMessage(error.message || 'Check-in failed. Please try again.');
    }
  };

  const renderContent = () => {
    switch (status) {
      case 'loading':
        return (
          <View style={styles.centerContent}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>Getting your location...</Text>
            <Text style={styles.loadingSubtext}>Please allow location access when prompted</Text>
          </View>
        );
        
      case 'ready':
        return (
          <View style={styles.centerContent}>
            <View style={styles.iconCircle}>
              <Ionicons name="location" size={60} color={COLORS.success} />
            </View>
            <Text style={styles.readyTitle}>Ready to Check In</Text>
            <Text style={styles.readySubtitle}>
              Your location has been confirmed.{'\n'}Tap the button below to complete check-in.
            </Text>
            
            {location && (
              <View style={styles.locationBox}>
                <Ionicons name="navigate" size={18} color={COLORS.secondary} />
                <Text style={styles.locationText}>
                  {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
                </Text>
              </View>
            )}
            
            <TouchableOpacity style={styles.checkinButton} onPress={handleCheckin}>
              <Ionicons name="checkmark-circle" size={24} color={COLORS.text} />
              <Text style={styles.checkinButtonText}>Check In Now</Text>
            </TouchableOpacity>
          </View>
        );
        
      case 'checking':
        return (
          <View style={styles.centerContent}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>Checking you in...</Text>
          </View>
        );
        
      case 'success':
        return (
          <View style={styles.centerContent}>
            <View style={[styles.iconCircle, { backgroundColor: COLORS.success + '20' }]}>
              <Ionicons name="checkmark-circle" size={80} color={COLORS.success} />
            </View>
            <Text style={styles.successTitle}>Check-In Complete!</Text>
            
            {checkinResult && (
              <View style={styles.workerCard}>
                <Text style={styles.workerName}>{checkinResult.worker.name}</Text>
                <Text style={styles.workerTrade}>{checkinResult.worker.trade}</Text>
                <View style={styles.divider} />
                <View style={styles.timeRow}>
                  <Ionicons name="time" size={18} color={COLORS.secondary} />
                  <Text style={styles.timeText}>
                    {new Date(checkinResult.checkin_time).toLocaleTimeString()}
                  </Text>
                </View>
              </View>
            )}
            
            <Text style={styles.successSubtitle}>
              Your check-in has been recorded and your credentials have been logged for today's DOB report.
            </Text>
            
            <TouchableOpacity 
              style={styles.viewPassportButton}
              onPress={() => router.replace('/')}
            >
              <Text style={styles.viewPassportText}>Go to Dashboard</Text>
            </TouchableOpacity>
          </View>
        );
        
      case 'error':
        return (
          <View style={styles.centerContent}>
            <View style={[styles.iconCircle, { backgroundColor: COLORS.danger + '20' }]}>
              <Ionicons name="alert-circle" size={80} color={COLORS.danger} />
            </View>
            <Text style={styles.errorTitle}>Check-In Failed</Text>
            <Text style={styles.errorMessage}>{errorMessage}</Text>
            
            <TouchableOpacity 
              style={styles.retryButton}
              onPress={() => {
                setStatus('loading');
                setErrorMessage('');
                requestLocationPermission();
              }}
            >
              <Ionicons name="refresh" size={20} color={COLORS.text} />
              <Text style={styles.retryText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        );
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>BLUEVIEW</Text>
        </View>
        <Text style={styles.headerSubtitle}>Site Check-In</Text>
      </View>

      {renderContent()}

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Your check-in is recorded for NYC DOB compliance
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    alignItems: 'center',
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  logo: {
    marginBottom: 4,
  },
  logoText: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.primary,
    letterSpacing: 2,
  },
  headerSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  iconCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  loadingText: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 20,
  },
  loadingSubtext: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 8,
    textAlign: 'center',
  },
  readyTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 12,
  },
  readySubtitle: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  locationBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 20,
    gap: 8,
  },
  locationText: {
    fontSize: 13,
    color: COLORS.secondary,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  checkinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.success,
    paddingHorizontal: 40,
    paddingVertical: 18,
    borderRadius: 16,
    marginTop: 32,
    gap: 12,
  },
  checkinButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  successTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.success,
    marginBottom: 16,
  },
  workerCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    alignItems: 'center',
    marginBottom: 20,
  },
  workerName: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
  },
  workerTrade: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  divider: {
    width: '100%',
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 16,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timeText: {
    fontSize: 16,
    color: COLORS.secondary,
    fontWeight: '600',
  },
  successSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 20,
  },
  viewPassportButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 24,
  },
  viewPassportText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.danger,
    marginBottom: 12,
  },
  errorMessage: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 24,
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  retryText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  footer: {
    paddingVertical: 16,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  footerText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
});
