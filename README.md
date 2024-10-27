# Use_Sensors
## Install ngrok
* for windows;
  * choco install ngrok
* for MacOs;
  * brew install ngrok/ngrok/ngrok
* for linux;
  * snap install ngrok
* see more : https://ngrok.com/download

## After installation, 
* You need to sign up to ngrok.
* Open terminal and write "ngrok config add-authtoken <token>"
* To start a tunnel: "ngrok http 80"

## How to Use
1) Open terminal and start a tunnel: "ngrok http 80"
2) This will give you a link. For example:
   * Forwarding                    *https://abcdefgh.ngrok-free.app* -> http://localhost:8000
   * you will use this link: *https://abcdefgh.ngrok-free.app*  (It will be different for your case)
3) Run "pip install -r requirments.txt" in terminal.
4) Run Server.py (you may use python Server.py in terminal)
5) Send the link to your phone and click to the link.
6) Initiate the connection by pushing the "Connect Web Socket" button (in your phone)
7) When you are ready, push the "Start Acquisition" button. It will collect accelerometer data in real time.
8) Push "Stop Acquisition" button to stop the data acquisition.
9) If you want to save it, you can click the "Save Data" button.
10) If you want to record yourself, you can use "Start Recording", "Stop Recording" and "Upload & Save Video" buttons.

## Contact
if you have questions, you can reach me via my email adress: 
baspinarlee@gmail.com    or    baspinar2000@hotmail.com
