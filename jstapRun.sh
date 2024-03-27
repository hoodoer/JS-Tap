#!/bin/bash


# Gunicorn variables
# workers should be num CPUs + 1 or so
# num threads is how my threads each worker runs
numWorkers="4"
numThreads="4"

listenPort="8444"


# Setting Proxy Mode to false here will use a self signed
# cert. You need to generate these cert files with:
# openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes
# When proxy mode is true, js-tap expects some nginx or similar front end to
# handle ssl, but also pulls the client IP from the X-Forwarded-For header
# instead of where the connection is coming from (which would be the proxy itself)
export PROXYMODE="False"

# Data Directory should have the trailing '/' added
export DATADIRECTORY="./"


KEYLENGTH="50"



# We need a secret key for session signatures
secret_key=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c $KEYLENGTH)
export SESSIONKEY=$secret_key



echo "Make selection on how to handle existing clients in the Database (if there are any):"
echo "1 - Keep existing client data"
echo "2 - Delete all client data and start fresh"

read input

case $input in 
	1)
		echo "Keeping existing client data"
		export CLIENTDATA="KEEP"
	;;
	2)
		echo "Deleting client data and starting fresh"
		export CLIENTDATA="DELETE"
	;;
	*)
		echo "Invalid selection. That was a pretty easy question you just missed."
		exit
	;;
esac


if [ "$PROXYMODE" = "False" ]; then
	gunicorn --certfile=./cert.pem --keyfile=./key.pem -w $numWorkers -k gthread --threads $numThreads -b 0.0.0.0:$listenPort --log-level info --error-logfile ./logs.txt jsTapServer:app
else
	gunicorn -w $numWorkers -k gthread --threads $numThreads -b 0.0.0.0:$listenPort --log-level info --error-logfile ./logs.txt jsTapServer:app
fi



