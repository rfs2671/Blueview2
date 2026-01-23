import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  ScrollView,
  Image,
  KeyboardAvoidingView,
  Platform,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';

// DESIGN SYSTEM: Construction-grade colors
// Deep Blue = Authority/Trust | Bright Green = Done/Success | Orange = Alert/Warning
const COLORS = {
  // Core backgrounds - dark, industrial, outdoor-ready
  background: '#0D1B2A',      // Deep navy - authority
  surface: '#1B263B',         // Elevated surface
  surfaceLight: '#253649',    // Input fields
  
  // Action colors - bold, high contrast for sunlight
  primary: '#00E676',         // Bright green - main CTA, success
  primaryDark: '#00C853',     // Darker green for pressed states
  secondary: '#2196F3',       // Trust blue - secondary actions
  
  // Status colors - clear, instant recognition
  success: '#00E676',         // Bright green - done/complete
  warning: '#FF9100',         // Orange - heads up/attention
  danger: '#FF5252',          // Red - error/stop
  
  // Text - maximum outdoor readability
  text: '#FFFFFF',
  textSecondary: '#90A4AE',
  textMuted: '#607D8B',
  
  // Borders
  border: '#37474F',
  borderLight: '#455A64',
};

const PASSPORT_STORAGE_KEY = 'blueview_worker_passport';

interface SiteInfo {
  tag_id: string;
  project_id: string;
  project_name: string;
  project_address: string;
  location_description: string;
}

interface WorkerPassport {
  id: string;
  name: string;
  osha_number: string;
  osha_card_type: string;
  trade: string;
  company: string;
  phone?: string;
  osha_expiry_date?: string;
}

interface CheckinResult {
  success: boolean;
  checkin_id: string;
  worker_name: string;
  project_name: string;
  check_in_time: string;
  already_checked_in: boolean;
  books_signed: {
    daily_signin: boolean;
    safety_meeting: boolean;
    site_orientation: boolean;
    first_visit: boolean;
  };
  message: string;
}

type ScreenStatus = 
  | 'loading' 
  | 'checking_passport' 
  | 'create_passport' 
  | 'ocr_processing'
  | 'confirm_info'
  | 'auto_checkin' 
  | 'success' 
  | 'error';

export default function NFCCheckinScreen() {
  const { tag } = useLocalSearchParams<{ tag: string }>();
  const router = useRouter();
  
  const [status, setStatus] = useState<ScreenStatus>('loading');
  const [siteInfo, setSiteInfo] = useState<SiteInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [storedPassport, setStoredPassport] = useState<WorkerPassport | null>(null);
  const [checkinResult, setCheckinResult] = useState<CheckinResult | null>(null);
  
  // New passport form fields
  const [oshaCardImage, setOshaCardImage] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [oshaNumber, setOshaNumber] = useState('');
  const [oshaCardType, setOshaCardType] = useState<'10' | '30'>('10');
  const [trade, setTrade] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  
  const API_URL = Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL || 
    process.env.EXPO_PUBLIC_BACKEND_URL || '';

  // Load stored passport on mount
  useEffect(() => {
    initializeScreen();
  }, [tag]);

  const initializeScreen = async () => {
    if (!tag) {
      setStatus('error');
      setErrorMessage('Invalid NFC tag. Please scan again.');
      return;
    }

    try {
      // Step 1: Verify NFC tag and get site info
      setStatus('loading');
      const siteResponse = await fetch(`${API_URL}/api/nfc-tags/${tag}/info`);
      
      if (!siteResponse.ok) {
        throw new Error('Invalid NFC tag');
      }
      
      const siteData: SiteInfo = await siteResponse.json();
      setSiteInfo(siteData);

      // Step 2: Check if worker has a stored passport
      setStatus('checking_passport');
      const passportData = await AsyncStorage.getItem(PASSPORT_STORAGE_KEY);
      
      if (passportData) {
        const passport: WorkerPassport = JSON.parse(passportData);
        setStoredPassport(passport);
        
        // Auto check-in for returning worker
        await performAutoCheckin(passport, siteData);
      } else {
        // New worker - needs to create passport
        setStatus('create_passport');
      }
      
    } catch (error: any) {
      setStatus('error');
      setErrorMessage(error.message || 'Could not verify NFC tag');
    }
  };

  const performAutoCheckin = async (passport: WorkerPassport, site: SiteInfo) => {
    setStatus('auto_checkin');
    
    try {
      const response = await fetch(`${API_URL}/api/passport/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tag_id: tag,
          device_passport_id: passport.id,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        // If passport not found on server, clear local and create new
        if (response.status === 404) {
          await AsyncStorage.removeItem(PASSPORT_STORAGE_KEY);
          setStoredPassport(null);
          setStatus('create_passport');
          return;
        }
        throw new Error(error.detail || 'Check-in failed');
      }

      const result: CheckinResult = await response.json();
      setCheckinResult(result);
      setStatus('success');
      
    } catch (error: any) {
      setStatus('error');
      setErrorMessage(error.message || 'Auto check-in failed');
    }
  };

  const pickOSHACard = async () => {
    const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
    
    if (!permissionResult.granted) {
      Alert.alert('Permission Required', 'Camera permission is needed to scan your OSHA card');
      return;
    }

    Alert.alert(
      'Scan OSHA Card',
      'Take a clear photo of your OSHA 10/30 card',
      [
        {
          text: 'Take Photo',
          onPress: async () => {
            const result = await ImagePicker.launchCameraAsync({
              mediaTypes: ['images'],
              allowsEditing: true,
              quality: 0.8,
              base64: true,
            });

            if (!result.canceled && result.assets[0].base64) {
              setOshaCardImage(result.assets[0].base64);
              processOCR(result.assets[0].base64);
            }
          },
        },
        {
          text: 'Choose from Library',
          onPress: async () => {
            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
              allowsEditing: true,
              quality: 0.8,
              base64: true,
            });

            if (!result.canceled && result.assets[0].base64) {
              setOshaCardImage(result.assets[0].base64);
              processOCR(result.assets[0].base64);
            }
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const processOCR = async (imageBase64: string) => {
    setStatus('ocr_processing');
    
    try {
      const response = await fetch(`${API_URL}/api/passport/ocr-osha-card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: imageBase64 }),
      });

      const result = await response.json();
      
      if (result.success && result.data) {
        setName(result.data.name || '');
        setOshaNumber(result.data.osha_number || '');
        setOshaCardType(result.data.card_type === '30' ? '30' : '10');
      }
      
      setStatus('confirm_info');
      
    } catch (error) {
      // If OCR fails, still let user enter info manually
      setStatus('confirm_info');
    }
  };

  const createPassportAndCheckin = async () => {
    if (!name.trim()) {
      Alert.alert('Required', 'Please enter your name');
      return;
    }
    if (!oshaNumber.trim()) {
      Alert.alert('Required', 'Please enter your OSHA card number');
      return;
    }

    setStatus('auto_checkin');

    try {
      // Create passport on server
      const passportResponse = await fetch(`${API_URL}/api/passport/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          osha_number: oshaNumber.trim(),
          osha_card_type: oshaCardType,
          trade: trade.trim() || 'General Labor',
          company: company.trim() || '',
          phone: phone.trim() || null,
          osha_card_image: oshaCardImage,
        }),
      });

      if (!passportResponse.ok) {
        throw new Error('Failed to create passport');
      }

      const passportResult = await passportResponse.json();
      
      // Save passport locally
      const localPassport: WorkerPassport = {
        id: passportResult.passport_id,
        name: name.trim(),
        osha_number: oshaNumber.trim(),
        osha_card_type: oshaCardType,
        trade: trade.trim() || 'General Labor',
        company: company.trim() || '',
        phone: phone.trim(),
      };
      
      await AsyncStorage.setItem(PASSPORT_STORAGE_KEY, JSON.stringify(localPassport));
      setStoredPassport(localPassport);

      // Now check in
      const checkinResponse = await fetch(`${API_URL}/api/passport/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tag_id: tag,
          device_passport_id: passportResult.passport_id,
        }),
      });

      if (!checkinResponse.ok) {
        throw new Error('Check-in failed');
      }

      const result: CheckinResult = await checkinResponse.json();
      setCheckinResult(result);
      setStatus('success');

    } catch (error: any) {
      setStatus('error');
      setErrorMessage(error.message || 'Failed to create passport');
    }
  };

  const renderContent = () => {
    switch (status) {
      case 'loading':
      case 'checking_passport':
        return (
          <View style={styles.centerContent}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>
              {status === 'loading' ? 'Verifying Job Site...' : 'Checking Your Passport...'}
            </Text>
          </View>
        );

      case 'auto_checkin':
        return (
          <View style={styles.centerContent}>
            <View style={styles.autoCheckinAnimation}>
              <Ionicons name="finger-print" size={64} color={COLORS.success} />
            </View>
            <Text style={styles.loadingText}>Signing You In...</Text>
            <Text style={styles.subText}>Auto-signing all required books</Text>
          </View>
        );

      case 'create_passport':
        return (
          <ScrollView style={styles.formScroll} contentContainerStyle={styles.formContent}>
            {/* Site Info */}
            <View style={styles.siteCard}>
              <Ionicons name="location" size={28} color={COLORS.success} />
              <Text style={styles.siteName}>{siteInfo?.project_name}</Text>
              <Text style={styles.siteAddress}>{siteInfo?.project_address}</Text>
            </View>

            {/* Welcome Message */}
            <View style={styles.welcomeSection}>
              <Ionicons name="id-card" size={48} color={COLORS.primary} />
              <Text style={styles.welcomeTitle}>Create Your Worker Passport</Text>
              <Text style={styles.welcomeText}>
                One-time setup. Scan your OSHA card and you'll never have to enter this info again!
              </Text>
            </View>

            {/* Scan OSHA Card Button */}
            <TouchableOpacity style={styles.scanButton} onPress={pickOSHACard}>
              <Ionicons name="camera" size={32} color={COLORS.text} />
              <View style={styles.scanButtonTextContainer}>
                <Text style={styles.scanButtonTitle}>Scan OSHA Card</Text>
                <Text style={styles.scanButtonSubtitle}>We'll extract your info automatically</Text>
              </View>
              <Ionicons name="chevron-forward" size={24} color={COLORS.textSecondary} />
            </TouchableOpacity>

            {/* Manual Entry Option */}
            <TouchableOpacity 
              style={styles.manualButton}
              onPress={() => setStatus('confirm_info')}
            >
              <Text style={styles.manualButtonText}>Or enter info manually</Text>
            </TouchableOpacity>
          </ScrollView>
        );

      case 'ocr_processing':
        return (
          <View style={styles.centerContent}>
            <ActivityIndicator size="large" color={COLORS.secondary} />
            <Text style={styles.loadingText}>Reading Your OSHA Card...</Text>
            <Text style={styles.subText}>AI is extracting your information</Text>
          </View>
        );

      case 'confirm_info':
        return (
          <KeyboardAvoidingView 
            style={{ flex: 1 }} 
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <ScrollView style={styles.formScroll} contentContainerStyle={styles.formContent}>
              {/* Site Info Mini */}
              <View style={styles.siteCardMini}>
                <Ionicons name="location" size={20} color={COLORS.success} />
                <Text style={styles.siteNameMini}>{siteInfo?.project_name}</Text>
              </View>

              {/* OSHA Card Preview */}
              {oshaCardImage && (
                <View style={styles.cardPreview}>
                  <Image 
                    source={{ uri: `data:image/jpeg;base64,${oshaCardImage}` }}
                    style={styles.cardImage}
                    resizeMode="contain"
                  />
                  <TouchableOpacity style={styles.retakeButton} onPress={pickOSHACard}>
                    <Ionicons name="camera" size={16} color={COLORS.text} />
                    <Text style={styles.retakeText}>Retake</Text>
                  </TouchableOpacity>
                </View>
              )}

              <Text style={styles.formTitle}>Confirm Your Information</Text>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Full Name *</Text>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="John Smith"
                  placeholderTextColor={COLORS.textSecondary}
                  autoCapitalize="words"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>OSHA Card Number *</Text>
                <TextInput
                  style={styles.input}
                  value={oshaNumber}
                  onChangeText={setOshaNumber}
                  placeholder="Enter card number"
                  placeholderTextColor={COLORS.textSecondary}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>OSHA Card Type</Text>
                <View style={styles.cardTypeRow}>
                  <TouchableOpacity 
                    style={[styles.cardTypeButton, oshaCardType === '10' && styles.cardTypeSelected]}
                    onPress={() => setOshaCardType('10')}
                  >
                    <Text style={[styles.cardTypeText, oshaCardType === '10' && styles.cardTypeTextSelected]}>
                      OSHA 10
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.cardTypeButton, oshaCardType === '30' && styles.cardTypeSelected]}
                    onPress={() => setOshaCardType('30')}
                  >
                    <Text style={[styles.cardTypeText, oshaCardType === '30' && styles.cardTypeTextSelected]}>
                      OSHA 30
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Trade</Text>
                <TextInput
                  style={styles.input}
                  value={trade}
                  onChangeText={setTrade}
                  placeholder="e.g., Electrician, Carpenter"
                  placeholderTextColor={COLORS.textSecondary}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Company</Text>
                <TextInput
                  style={styles.input}
                  value={company}
                  onChangeText={setCompany}
                  placeholder="Your employer"
                  placeholderTextColor={COLORS.textSecondary}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Phone (Optional)</Text>
                <TextInput
                  style={styles.input}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="For emergency contact"
                  placeholderTextColor={COLORS.textSecondary}
                  keyboardType="phone-pad"
                />
              </View>

              <TouchableOpacity style={styles.createButton} onPress={createPassportAndCheckin}>
                <Ionicons name="checkmark-circle" size={24} color={COLORS.text} />
                <Text style={styles.createButtonText}>Create Passport & Check In</Text>
              </TouchableOpacity>

              <Text style={styles.privacyNote}>
                Your passport is stored securely on your device. You won't need to enter this again.
              </Text>
            </ScrollView>
          </KeyboardAvoidingView>
        );

      case 'success':
        return (
          <View style={styles.centerContent}>
            <View style={styles.successIcon}>
              <Ionicons name="checkmark-circle" size={100} color={COLORS.success} />
            </View>
            
            <Text style={styles.successTitle}>
              {checkinResult?.already_checked_in ? 'Already Checked In!' : 'Check-In Complete!'}
            </Text>
            
            <View style={styles.resultCard}>
              <Text style={styles.resultName}>{checkinResult?.worker_name}</Text>
              <View style={styles.resultDivider} />
              
              <View style={styles.resultRow}>
                <Ionicons name="location" size={18} color={COLORS.secondary} />
                <Text style={styles.resultText}>{checkinResult?.project_name || siteInfo?.project_name}</Text>
              </View>
              
              <View style={styles.resultRow}>
                <Ionicons name="time" size={18} color={COLORS.secondary} />
                <Text style={styles.resultText}>
                  {checkinResult?.check_in_time 
                    ? new Date(checkinResult.check_in_time).toLocaleTimeString() 
                    : new Date().toLocaleTimeString()}
                </Text>
              </View>
            </View>

            {/* Books Signed Summary */}
            {checkinResult?.books_signed && !checkinResult.already_checked_in && (
              <View style={styles.booksSignedCard}>
                <Text style={styles.booksTitle}>✅ All Books Signed</Text>
                <View style={styles.bookItem}>
                  <Ionicons name="document-text" size={16} color={COLORS.success} />
                  <Text style={styles.bookText}>Daily Sign-In Sheet</Text>
                </View>
                <View style={styles.bookItem}>
                  <Ionicons name="shield-checkmark" size={16} color={COLORS.success} />
                  <Text style={styles.bookText}>Safety Meeting</Text>
                </View>
                {checkinResult.books_signed.first_visit && (
                  <View style={styles.bookItem}>
                    <Ionicons name="school" size={16} color={COLORS.warning} />
                    <Text style={styles.bookText}>Site Orientation (First Visit)</Text>
                  </View>
                )}
              </View>
            )}

            <Text style={styles.successNote}>
              Have a safe and productive day!
            </Text>
          </View>
        );

      case 'error':
        return (
          <View style={styles.centerContent}>
            <View style={styles.errorIcon}>
              <Ionicons name="alert-circle" size={80} color={COLORS.danger} />
            </View>
            <Text style={styles.errorTitle}>Something Went Wrong</Text>
            <Text style={styles.errorMessage}>{errorMessage}</Text>
            
            <TouchableOpacity style={styles.retryButton} onPress={initializeScreen}>
              <Ionicons name="refresh" size={20} color={COLORS.text} />
              <Text style={styles.retryText}>Try Again</Text>
            </TouchableOpacity>

            {/* Option to clear passport and start fresh */}
            <TouchableOpacity 
              style={styles.clearButton}
              onPress={async () => {
                await AsyncStorage.removeItem(PASSPORT_STORAGE_KEY);
                setStoredPassport(null);
                initializeScreen();
              }}
            >
              <Text style={styles.clearButtonText}>Reset & Create New Passport</Text>
            </TouchableOpacity>
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.logoContainer}>
            <Ionicons name="construct" size={28} color={COLORS.primary} />
            <Text style={styles.logoText}>BLUEVIEW</Text>
          </View>
          <Text style={styles.headerSubtitle}>Worker Passport</Text>
        </View>
      </View>

      {renderContent()}

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          NYC DOB Compliant • Your data is secure
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
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerContent: {
    alignItems: 'center',
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoText: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.primary,
    letterSpacing: 1,
  },
  headerSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  loadingText: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 16,
  },
  subText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  autoCheckinAnimation: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: COLORS.success + '20',
    justifyContent: 'center',
    alignItems: 'center',
  },
  formScroll: {
    flex: 1,
  },
  formContent: {
    padding: 16,
    paddingBottom: 32,
  },
  siteCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 16,
    flexDirection: 'row',
    gap: 12,
  },
  siteName: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    flex: 1,
  },
  siteAddress: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  siteCardMini: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  siteNameMini: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  welcomeSection: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  welcomeTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 12,
  },
  welcomeText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 16,
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  scanButtonTextContainer: {
    flex: 1,
  },
  scanButtonTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  scanButtonSubtitle: {
    fontSize: 12,
    color: COLORS.text + 'CC',
    marginTop: 2,
  },
  manualButton: {
    alignItems: 'center',
    padding: 16,
  },
  manualButtonText: {
    fontSize: 14,
    color: COLORS.secondary,
    textDecorationLine: 'underline',
  },
  cardPreview: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    alignItems: 'center',
  },
  cardImage: {
    width: '100%',
    height: 150,
    borderRadius: 8,
  },
  retakeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    padding: 8,
  },
  retakeText: {
    fontSize: 12,
    color: COLORS.text,
  },
  formTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 14,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 6,
  },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardTypeRow: {
    flexDirection: 'row',
    gap: 12,
  },
  cardTypeButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  cardTypeSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '20',
  },
  cardTypeText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  cardTypeTextSelected: {
    color: COLORS.primary,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.success,
    borderRadius: 12,
    paddingVertical: 16,
    marginTop: 8,
    gap: 10,
  },
  createButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  privacyNote: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 12,
  },
  successIcon: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: COLORS.success + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  successTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: COLORS.success,
    marginBottom: 16,
  },
  resultCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    alignItems: 'center',
  },
  resultName: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
  },
  resultDivider: {
    width: '100%',
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 14,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  resultText: {
    fontSize: 16,
    color: COLORS.text,
  },
  booksSignedCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 16,
    width: '100%',
    marginTop: 16,
  },
  booksTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.success,
    marginBottom: 10,
  },
  bookItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  bookText: {
    fontSize: 13,
    color: COLORS.text,
  },
  successNote: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 16,
  },
  errorIcon: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.danger + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.danger,
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 20,
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  retryText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  clearButton: {
    marginTop: 16,
    padding: 12,
  },
  clearButtonText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textDecorationLine: 'underline',
  },
  footer: {
    paddingVertical: 12,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  footerText: {
    fontSize: 11,
    color: COLORS.textSecondary,
  },
});
