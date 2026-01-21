import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  TextInput,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
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

interface SiteInfo {
  tag_id: string;
  project_id: string;
  project_name: string;
  project_address: string;
  location_description: string;
}

interface CheckinResult {
  checkin_id: string;
  worker_name: string;
  project_id: string;
  check_in_time: string;
}

export default function NFCCheckinScreen() {
  const { tag } = useLocalSearchParams<{ tag: string }>();
  const router = useRouter();
  
  const [status, setStatus] = useState<'loading' | 'site_info' | 'worker_select' | 'checking' | 'success' | 'error'>('loading');
  const [siteInfo, setSiteInfo] = useState<SiteInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [workerName, setWorkerName] = useState('');
  const [oshaNumber, setOshaNumber] = useState('');
  const [checkinResult, setCheckinResult] = useState<CheckinResult | null>(null);
  
  const API_URL = Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL || 
    process.env.EXPO_PUBLIC_BACKEND_URL || '';

  useEffect(() => {
    if (!tag) {
      setStatus('error');
      setErrorMessage('Invalid NFC tag. Please scan again.');
      return;
    }
    fetchSiteInfo();
  }, [tag]);

  const fetchSiteInfo = async () => {
    try {
      const response = await fetch(`${API_URL}/api/nfc-tags/${tag}/info`);
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Invalid NFC tag');
      }
      
      const data: SiteInfo = await response.json();
      setSiteInfo(data);
      setStatus('worker_select');
      
    } catch (error: any) {
      setStatus('error');
      setErrorMessage(error.message || 'Could not verify NFC tag');
    }
  };

  const handleCheckin = async () => {
    if (!workerName.trim()) {
      Alert.alert('Required', 'Please enter your name');
      return;
    }
    
    setStatus('checking');
    
    try {
      // First create/find worker if needed
      let workerIdToUse = workerId;
      
      if (!workerIdToUse) {
        // Create a quick worker entry
        const workerRes = await fetch(`${API_URL}/api/workers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: workerName.trim(),
            osha_number: oshaNumber.trim() || null,
            trade: 'General',
            company: 'On-Site',
          }),
        });
        
        if (workerRes.ok) {
          const workerData = await workerRes.json();
          workerIdToUse = workerData.id;
        }
      }
      
      // Now do the check-in
      const response = await fetch(`${API_URL}/api/nfc-checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tag_id: tag,
          worker_id: workerIdToUse,
          signature: null,
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
      setErrorMessage(error.message || 'Check-in failed');
    }
  };

  const renderContent = () => {
    switch (status) {
      case 'loading':
        return (
          <View style={styles.centerContent}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>Verifying NFC Tag...</Text>
          </View>
        );
        
      case 'worker_select':
        return (
          <ScrollView style={styles.formScroll} contentContainerStyle={styles.formContent}>
            {/* Site Info */}
            <View style={styles.siteCard}>
              <View style={styles.siteIcon}>
                <Ionicons name="location" size={32} color={COLORS.success} />
              </View>
              <Text style={styles.siteName}>{siteInfo?.project_name}</Text>
              <Text style={styles.siteAddress}>{siteInfo?.project_address}</Text>
              {siteInfo?.location_description && (
                <Text style={styles.siteLocation}>📍 {siteInfo.location_description}</Text>
              )}
            </View>
            
            {/* Worker Form */}
            <View style={styles.formSection}>
              <Text style={styles.formTitle}>Worker Check-In</Text>
              <Text style={styles.formSubtitle}>Enter your information to check in</Text>
              
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Full Name *</Text>
                <TextInput
                  style={styles.input}
                  value={workerName}
                  onChangeText={setWorkerName}
                  placeholder="Enter your full name"
                  placeholderTextColor={COLORS.textSecondary}
                  autoCapitalize="words"
                />
              </View>
              
              <View style={styles.inputGroup}>
                <Text style={styles.label}>OSHA Card Number</Text>
                <TextInput
                  style={styles.input}
                  value={oshaNumber}
                  onChangeText={setOshaNumber}
                  placeholder="Enter your OSHA number"
                  placeholderTextColor={COLORS.textSecondary}
                />
              </View>
              
              <TouchableOpacity style={styles.checkinButton} onPress={handleCheckin}>
                <Ionicons name="checkmark-circle" size={24} color={COLORS.text} />
                <Text style={styles.checkinButtonText}>Check In Now</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
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
            <View style={styles.successIcon}>
              <Ionicons name="checkmark-circle" size={80} color={COLORS.success} />
            </View>
            <Text style={styles.successTitle}>Check-In Complete!</Text>
            
            <View style={styles.resultCard}>
              <Text style={styles.resultName}>{checkinResult?.worker_name || workerName}</Text>
              <View style={styles.resultDivider} />
              <View style={styles.resultRow}>
                <Ionicons name="location" size={18} color={COLORS.secondary} />
                <Text style={styles.resultText}>{siteInfo?.project_name}</Text>
              </View>
              <View style={styles.resultRow}>
                <Ionicons name="time" size={18} color={COLORS.secondary} />
                <Text style={styles.resultText}>
                  {checkinResult?.check_in_time ? new Date(checkinResult.check_in_time).toLocaleTimeString() : new Date().toLocaleTimeString()}
                </Text>
              </View>
            </View>
            
            <Text style={styles.successNote}>
              Your check-in has been recorded for today's daily log.
            </Text>
            
            <TouchableOpacity 
              style={styles.doneButton}
              onPress={() => {
                // Reset for another check-in
                setStatus('worker_select');
                setWorkerName('');
                setOshaNumber('');
                setCheckinResult(null);
              }}
            >
              <Text style={styles.doneButtonText}>Check In Another Worker</Text>
            </TouchableOpacity>
          </View>
        );
        
      case 'error':
        return (
          <View style={styles.centerContent}>
            <View style={styles.errorIcon}>
              <Ionicons name="alert-circle" size={80} color={COLORS.danger} />
            </View>
            <Text style={styles.errorTitle}>Check-In Failed</Text>
            <Text style={styles.errorMessage}>{errorMessage}</Text>
            
            <TouchableOpacity 
              style={styles.retryButton}
              onPress={() => {
                setStatus('loading');
                setErrorMessage('');
                fetchSiteInfo();
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
        <Text style={styles.headerSubtitle}>NFC Check-In</Text>
      </View>

      {renderContent()}

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Your attendance is recorded for NYC DOB compliance
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
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  logo: {
    marginBottom: 4,
  },
  logoText: {
    fontSize: 24,
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
  loadingText: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 20,
  },
  formScroll: {
    flex: 1,
  },
  formContent: {
    padding: 20,
  },
  siteCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 20,
  },
  siteIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.success + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  siteName: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  siteAddress: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 4,
  },
  siteLocation: {
    fontSize: 13,
    color: COLORS.secondary,
    marginTop: 8,
  },
  formSection: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
  },
  formTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4,
  },
  formSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 20,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  input: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  checkinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.success,
    borderRadius: 12,
    paddingVertical: 16,
    marginTop: 8,
    gap: 10,
  },
  checkinButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  successIcon: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.success + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  successTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.success,
    marginBottom: 20,
  },
  resultCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    alignItems: 'center',
    marginBottom: 20,
  },
  resultName: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
  },
  resultDivider: {
    width: '100%',
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 16,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  resultText: {
    fontSize: 16,
    color: COLORS.text,
  },
  successNote: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  doneButton: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    marginTop: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  doneButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  errorIcon: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.danger + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
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
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    paddingHorizontal: 24,
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
