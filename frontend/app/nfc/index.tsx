import React, { useState, useEffect, useRef } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import SignatureCanvas from 'react-native-signature-canvas';

const COLORS = {
  background: '#0D1B2A',
  surface: '#1B263B',
  surfaceLight: '#253649',
  primary: '#00E676',
  primaryDark: '#00C853',
  secondary: '#2196F3',
  success: '#00E676',
  warning: '#FF9100',
  danger: '#FF5252',
  text: '#FFFFFF',
  textSecondary: '#90A4AE',
  textMuted: '#607D8B',
  border: '#37474F',
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
  signature?: string;
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
  | 'capture_signature'
  | 'auto_checkin' 
  | 'success' 
  | 'error';

export default function NFCCheckinScreen() {
  const { tag } = useLocalSearchParams<{ tag: string }>();
  const router = useRouter();
  const signatureRef = useRef<any>(null);
  
  const [status, setStatus] = useState<ScreenStatus>('loading');
  const [siteInfo, setSiteInfo] = useState<SiteInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [storedPassport, setStoredPassport] = useState<WorkerPassport | null>(null);
  const [checkinResult, setCheckinResult] = useState<CheckinResult | null>(null);
  
  // Passport form fields
  const [oshaCardImage, setOshaCardImage] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [oshaNumber, setOshaNumber] = useState('');
  const [oshaCardType, setOshaCardType] = useState<'10' | '30'>('10');
  const [trade, setTrade] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  
const API_URL = 'https://blueview2-production.up.railway.app';

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
        
        // Verify passport exists on server
        const verifyResponse = await fetch(`${API_URL}/api/passport/${passport.id}/verify`);
        
        if (verifyResponse.ok) {
          // Auto check-in for returning worker
          await performAutoCheckin(passport, siteData);
        } else {
          // Passport not found on server, clear local and create new
          await AsyncStorage.removeItem(PASSPORT_STORAGE_KEY);
          setStoredPassport(null);
          setStatus('create_passport');
        }
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
          passport_id: passport.id,
          // Signature is stored on server, used for auto-signing log books
        }),
      });

      if (!response.ok) {
        const error = await response.json();
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
      
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      
    } catch (error: any) {
      setStatus('error');
      setErrorMessage(error.message || 'Auto check-in failed');
    }
  };

  const pickOSHACard = async () => {
    Alert.alert(
      'Scan OSHA Card',
      'Take a clear photo of your OSHA 10/30 card',
      [
        {
          text: 'Take Photo',
          onPress: async () => {
            const { status } = await ImagePicker.requestCameraPermissionsAsync();
            if (status !== 'granted') {
              Alert.alert('Permission Required', 'Camera permission is needed');
              return;
            }
            
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
      setStatus('confirm_info');
    }
  };

  const handleSignatureSaved = (signatureData: string) => {
    setSignature(signatureData);
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const clearSignature = () => {
    signatureRef.current?.clearSignature();
    setSignature(null);
  };

  const proceedToSignature = () => {
    if (!name.trim()) {
      Alert.alert('Required', 'Please enter your name');
      return;
    }
    if (!oshaNumber.trim()) {
      Alert.alert('Required', 'Please enter your OSHA card number');
      return;
    }
    setStatus('capture_signature');
  };

  const createPassportAndCheckin = async () => {
    if (!signature) {
      Alert.alert('Required', 'Please sign to continue');
      return;
    }

    setStatus('auto_checkin');

    try {
      // Create passport on server (includes signature for auto-signing)
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
          signature: signature, // Stored on server for auto-signing log books
        }),
      });

      if (!passportResponse.ok) {
        const error = await passportResponse.json();
        throw new Error(error.detail || 'Failed to create passport');
      }

      const passportResult = await passportResponse.json();
      
      // Save passport locally for quick identification
      const localPassport: WorkerPassport = {
        id: passportResult.passport_id,
        name: name.trim(),
        osha_number: oshaNumber.trim(),
        osha_card_type: oshaCardType,
        trade: trade.trim() || 'General Labor',
        company: company.trim() || '',
        phone: phone.trim(),
        signature: signature,
      };
      
      await AsyncStorage.setItem(PASSPORT_STORAGE_KEY, JSON.stringify(localPassport));
      setStoredPassport(localPassport);

      // Now check in
      const checkinResponse = await fetch(`${API_URL}/api/passport/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tag_id: tag,
          passport_id: passportResult.passport_id,
        }),
      });

      if (!checkinResponse.ok) {
        throw new Error('Check-in failed');
      }

      const result: CheckinResult = await checkinResponse.json();
      setCheckinResult(result);
      setStatus('success');

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

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
            <View style={styles.siteCard}>
              <Ionicons name="location" size={28} color={COLORS.success} />
              <View style={styles.siteCardInfo}>
                <Text style={styles.siteName}>{siteInfo?.project_name}</Text>
                <Text style={styles.siteAddress}>{siteInfo?.project_address}</Text>
              </View>
            </View>

            <View style={styles.welcomeSection}>
              <Ionicons name="id-card" size={48} color={COLORS.primary} />
              <Text style={styles.welcomeTitle}>Create Your Worker Passport</Text>
              <Text style={styles.welcomeText}>
                One-time setup. Your info and signature will be saved for instant daily check-ins!
              </Text>
            </View>

            <TouchableOpacity style={styles.scanButton} onPress={pickOSHACard}>
              <Ionicons name="camera" size={32} color="#000" />
              <View style={styles.scanButtonTextContainer}>
                <Text style={styles.scanButtonTitle}>Scan OSHA Card</Text>
                <Text style={styles.scanButtonSubtitle}>We'll extract your info automatically</Text>
              </View>
              <Ionicons name="chevron-forward" size={24} color="#000" />
            </TouchableOpacity>

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
              <View style={styles.siteCardMini}>
                <Ionicons name="location" size={20} color={COLORS.success} />
                <Text style={styles.siteNameMini}>{siteInfo?.project_name}</Text>
              </View>

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

              <Text style={styles.formTitle}>Your Information</Text>

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

              <TouchableOpacity style={styles.nextButton} onPress={proceedToSignature}>
                <Text style={styles.nextButtonText}>Next: Add Signature</Text>
                <Ionicons name="arrow-forward" size={20} color="#000" />
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        );

      case 'capture_signature':
        return (
          <View style={styles.signatureScreen}>
            <View style={styles.siteCardMini}>
              <Ionicons name="location" size={20} color={COLORS.success} />
              <Text style={styles.siteNameMini}>{siteInfo?.project_name}</Text>
            </View>

            <Text style={styles.signatureTitle}>Your Digital Signature</Text>
            <Text style={styles.signatureSubtitle}>
              This signature will be used to auto-sign daily log books when you check in
            </Text>

            <View style={styles.signatureContainer}>
              {Platform.OS !== 'web' ? (
                <SignatureCanvas
                  ref={signatureRef}
                  onOK={handleSignatureSaved}
                  onEmpty={() => setSignature(null)}
                  descriptionText=""
                  clearText="Clear"
                  confirmText="Save"
                  webStyle={`
                    .m-signature-pad { box-shadow: none; border: none; }
                    .m-signature-pad--body { border: none; }
                    .m-signature-pad--footer { display: none; }
                    body { background-color: #ffffff; }
                  `}
                  backgroundColor="white"
                  penColor="black"
                  style={styles.signaturePad}
                />
              ) : (
                <View style={styles.webSignaturePlaceholder}>
                  <Text style={styles.webSignatureText}>
                    Signature capture requires mobile device
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.signatureActions}>
              <TouchableOpacity style={styles.clearSigButton} onPress={clearSignature}>
                <Ionicons name="refresh" size={20} color={COLORS.text} />
                <Text style={styles.clearSigText}>Clear</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={styles.saveSigButton} 
                onPress={() => signatureRef.current?.readSignature()}
              >
                <Ionicons name="checkmark" size={20} color={COLORS.text} />
                <Text style={styles.saveSigText}>Confirm Signature</Text>
              </TouchableOpacity>
            </View>

            {signature && (
              <View style={styles.signaturePreview}>
                <Ionicons name="checkmark-circle" size={24} color={COLORS.success} />
                <Text style={styles.signaturePreviewText}>Signature captured!</Text>
              </View>
            )}

            <TouchableOpacity 
              style={[styles.createButton, !signature && styles.createButtonDisabled]} 
              onPress={createPassportAndCheckin}
              disabled={!signature}
            >
              <Ionicons name="checkmark-circle" size={24} color="#000" />
              <Text style={styles.createButtonText}>Create Passport & Check In</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.backToInfoButton}
              onPress={() => setStatus('confirm_info')}
            >
              <Text style={styles.backToInfoText}>← Back to edit info</Text>
            </TouchableOpacity>
          </View>
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
              <Text style={styles.resultName}>{checkinResult?.worker_name || storedPassport?.name}</Text>
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

            {checkinResult?.books_signed && !checkinResult.already_checked_in && (
              <View style={styles.booksSignedCard}>
                <Text style={styles.booksTitle}>✅ All Books Auto-Signed</Text>
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
            
            <TouchableOpacity style={styles.retryButtonLarge} onPress={initializeScreen}>
              <Ionicons name="refresh" size={20} color={COLORS.text} />
              <Text style={styles.retryTextLarge}>Try Again</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.resetButton}
              onPress={async () => {
                await AsyncStorage.removeItem(PASSPORT_STORAGE_KEY);
                setStoredPassport(null);
                initializeScreen();
              }}
            >
              <Text style={styles.resetButtonText}>Reset & Create New Passport</Text>
            </TouchableOpacity>
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.logoContainer}>
            <Ionicons name="construct" size={28} color={COLORS.primary} />
            <Text style={styles.logoText}>BLUEVIEW</Text>
          </View>
          <Text style={styles.headerSubtitle}>Worker Check-In</Text>
        </View>
      </View>

      {renderContent()}

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          NYC DOB Compliant • Your signature is securely stored
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
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 2,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  headerContent: {
    alignItems: 'center',
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoText: {
    fontSize: 26,
    fontWeight: '900',
    color: COLORS.secondary,
    letterSpacing: 2,
  },
  headerSubtitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  loadingText: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 20,
  },
  subText: {
    fontSize: 16,
    color: COLORS.textSecondary,
    marginTop: 6,
  },
  autoCheckinAnimation: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.success + '30',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: COLORS.success,
  },
  formScroll: {
    flex: 1,
  },
  formContent: {
    padding: 20,
    paddingBottom: 40,
  },
  siteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    gap: 12,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.success,
  },
  siteCardInfo: {
    flex: 1,
  },
  siteName: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text,
  },
  siteAddress: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  siteCardMini: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  siteNameMini: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  welcomeSection: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  welcomeTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.text,
    marginTop: 16,
    textAlign: 'center',
  },
  welcomeText: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 22,
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    padding: 20,
    gap: 14,
    minHeight: 80,
  },
  scanButtonTextContainer: {
    flex: 1,
  },
  scanButtonTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#000',
  },
  scanButtonSubtitle: {
    fontSize: 13,
    color: '#000000AA',
    marginTop: 2,
  },
  manualButton: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  manualButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.secondary,
  },
  cardPreview: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
    alignItems: 'center',
  },
  cardImage: {
    width: '100%',
    height: 140,
    borderRadius: 8,
  },
  retakeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    padding: 10,
  },
  retakeText: {
    fontSize: 14,
    color: COLORS.text,
  },
  formTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 16,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 6,
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
  cardTypeRow: {
    flexDirection: 'row',
    gap: 12,
  },
  cardTypeButton: {
    flex: 1,
    paddingVertical: 14,
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
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  cardTypeTextSelected: {
    color: COLORS.primary,
  },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 16,
    gap: 8,
    marginTop: 8,
  },
  nextButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },
  signatureScreen: {
    flex: 1,
    padding: 20,
  },
  signatureTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
    marginTop: 10,
  },
  signatureSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 20,
  },
  signatureContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    height: 200,
    overflow: 'hidden',
  },
  signaturePad: {
    flex: 1,
  },
  webSignaturePlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  webSignatureText: {
    color: COLORS.textMuted,
  },
  signatureActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  clearSigButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    paddingVertical: 12,
    gap: 6,
  },
  clearSigText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  saveSigButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.secondary,
    borderRadius: 10,
    paddingVertical: 12,
    gap: 6,
  },
  saveSigText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  signaturePreview: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    gap: 8,
  },
  signaturePreviewText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.success,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 18,
    marginTop: 20,
    gap: 10,
  },
  createButtonDisabled: {
    opacity: 0.5,
  },
  createButtonText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#000',
  },
  backToInfoButton: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  backToInfoText: {
    fontSize: 15,
    color: COLORS.secondary,
  },
  successIcon: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: COLORS.success + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  successTitle: {
    fontSize: 28,
    fontWeight: '800',
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
    fontWeight: '800',
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
    marginBottom: 8,
  },
  resultText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  booksSignedCard: {
    backgroundColor: COLORS.success + '15',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    marginTop: 16,
    borderWidth: 1,
    borderColor: COLORS.success + '40',
  },
  booksTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.success,
    marginBottom: 10,
  },
  bookItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  bookText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
  },
  successNote: {
    fontSize: 15,
    color: COLORS.textSecondary,
    marginTop: 20,
  },
  errorIcon: {
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: COLORS.danger + '20',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.danger,
    marginBottom: 10,
  },
  errorMessage: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  retryButtonLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.secondary,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 24,
    gap: 8,
  },
  retryTextLarge: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  resetButton: {
    marginTop: 16,
    padding: 12,
  },
  resetButtonText: {
    fontSize: 14,
    color: COLORS.textMuted,
  },
  footer: {
    paddingVertical: 14,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  footerText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
});
