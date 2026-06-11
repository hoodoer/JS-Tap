"""
CA certificate generation and per-domain cert signing for the MITM proxy.
Uses the cryptography library (already a project dependency).
"""
import os
import datetime
import logging
from cryptography import x509
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa

logger = logging.getLogger('jsTap')

# Directory where CA cert/key are stored
CERT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'proxy_ca')

CA_KEY_PATH  = os.path.join(CERT_DIR, 'ca.key')
CA_CERT_PATH = os.path.join(CERT_DIR, 'ca.pem')

# In-memory cache: domain -> (cert_pem_bytes, key_pem_bytes)
_domain_cert_cache = {}


def _generate_ca():
    """Generate a new CA key + self-signed certificate."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "JS-Tap Proxy"),
        x509.NameAttribute(NameOID.COMMON_NAME, "JS-Tap Proxy CA"),
    ])

    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.utcnow() - datetime.timedelta(days=1))
        .not_valid_after(datetime.datetime.utcnow() + datetime.timedelta(days=3650))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True, key_cert_sign=True, crl_sign=True,
                content_commitment=False, key_encipherment=False,
                data_encipherment=False, key_agreement=False,
                encipher_only=False, decipher_only=False,
            ),
            critical=True,
        )
        .sign(key, hashes.SHA256())
    )

    return key, cert


def ensure_ca():
    """Load existing CA or generate a new one. Returns (ca_key, ca_cert)."""
    os.makedirs(CERT_DIR, exist_ok=True)

    if os.path.exists(CA_KEY_PATH) and os.path.exists(CA_CERT_PATH):
        with open(CA_KEY_PATH, 'rb') as f:
            ca_key = serialization.load_pem_private_key(f.read(), password=None)
        with open(CA_CERT_PATH, 'rb') as f:
            ca_cert = x509.load_pem_x509_certificate(f.read())
        logger.info("Proxy CA: Loaded existing CA certificate")
        return ca_key, ca_cert

    logger.info("Proxy CA: Generating new CA certificate...")
    ca_key, ca_cert = _generate_ca()

    with open(CA_KEY_PATH, 'wb') as f:
        f.write(ca_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        ))
    os.chmod(CA_KEY_PATH, 0o600)

    with open(CA_CERT_PATH, 'wb') as f:
        f.write(ca_cert.public_bytes(serialization.Encoding.PEM))

    logger.info(f"Proxy CA: Saved to {CERT_DIR}/")
    logger.info(f"Proxy CA: Import {CA_CERT_PATH} into your browser to trust the proxy")
    return ca_key, ca_cert


def generate_domain_cert(domain, ca_key, ca_cert):
    """Generate a TLS certificate for *domain*, signed by the CA.
    Returns (cert_pem_bytes, key_pem_bytes). Results are cached in memory."""
    if domain in _domain_cert_cache:
        return _domain_cert_cache[domain]

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    subject = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, domain),
    ])

    san = x509.SubjectAlternativeName([x509.DNSName(domain)])

    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(ca_cert.subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.utcnow() - datetime.timedelta(days=1))
        .not_valid_after(datetime.datetime.utcnow() + datetime.timedelta(days=365))
        .add_extension(san, critical=False)
        .add_extension(
            x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),
            critical=False,
        )
        .sign(ca_key, hashes.SHA256())
    )

    cert_pem = cert.public_bytes(serialization.Encoding.PEM)
    key_pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption(),
    )

    _domain_cert_cache[domain] = (cert_pem, key_pem)
    return cert_pem, key_pem
